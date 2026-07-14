/**
 * Onboarding worker (Step P4.1).
 *
 * Polls QUEUED `OnboardingJob` rows and runs the in-process TS pipeline
 * (expand → extract → create-account) against each. This replaces the old
 * `claude -p` subprocess spawn in src/lib/onboarding.ts's `startOnboardingJob`,
 * which broke once the CRM was Dockerized (no `claude` binary in the image).
 *
 * Mirrors scripts/process-email-jobs.ts: single-shot batch by default, or a
 * poll loop with `--loop`. It writes `OnboardingJobEvent` rows so the CRM's
 * "Derniers jobs" monitor keeps rendering a live event timeline, and maps the
 * pipeline result onto the `OnboardingJob` row (status / account / counts /
 * warnings / error) plus backfills `salon.address/lat/lng` — exactly like the
 * legacy child-process exit handler did.
 *
 * Env (loaded from .env via @next/env, same as the email worker):
 *   - DATABASE_URL                     — Postgres (Prisma)
 *   - ANTHROPIC_API_KEY                — Haiku extraction
 *   - GOOGLE_APPLICATION_CREDENTIALS   — firebase-admin service-account path
 * Chromium must be installed (playwright) for the expand step.
 */

import { loadEnvConfig } from "@next/env";
import type { PrismaClient } from "../src/generated/prisma/client";

loadEnvConfig(process.cwd());

const batchSize = Math.max(1, Number(process.env.ONBOARDING_JOB_BATCH_SIZE || 5));
const loop = process.argv.includes("--loop");
const pollMs = Math.max(5, Number(process.env.ONBOARDING_JOB_POLL_SECONDS || 60)) * 1000;

type Prisma = PrismaClient;
type OnboardingHints = import("../src/lib/onboarding").OnboardingHints;
type OnboardingOverrides = import("../src/lib/onboarding").OnboardingOverrides;

// The env-dependent modules (Prisma reads DATABASE_URL at construction; the
// pipeline pulls in firebase-admin / Anthropic / playwright) are imported
// dynamically inside main() so `loadEnvConfig` has already run — matching the
// email worker. Bundle the pieces so the helpers stay parameterised.
type Pipeline = {
  expandSalonPage: typeof import("../src/lib/onboarding/expand").expandSalonPage;
  extractSalon: typeof import("../src/lib/onboarding/extract").extractSalon;
  createDisabledSalonAccount: typeof import("../src/lib/onboarding/create-account").createDisabledSalonAccount;
  encrypt: typeof import("../src/lib/crypto").encrypt;
};

// --- event helpers ---------------------------------------------------------

function boundedText(value: string | null | undefined, max = 4000): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function boundedJson(value: unknown) {
  if (value == null) return undefined;
  try {
    const json = JSON.stringify(value);
    if (json.length <= 16000) return value as object;
    return { truncated: true, originalBytes: Buffer.byteLength(json), preview: json.slice(0, 16000) };
  } catch {
    return { unserializable: true, value: String(value) };
  }
}

type EventStream = "stdout" | "stderr" | "system";
type EventFields = { type?: string; subtype?: string; level?: string; text?: string | null; data?: unknown };
type Emit = (stream: EventStream, fields: EventFields) => Promise<void>;

/**
 * Builds an append-only event logger for one job. Seeds the sequence from the
 * job's current max so a requeued/retried job keeps unique, monotonic
 * sequences (the `@@unique([jobId, sequence])` constraint).
 */
async function makeEmitter(prisma: Prisma, jobId: string): Promise<Emit> {
  const agg = await prisma.onboardingJobEvent.aggregate({ where: { jobId }, _max: { sequence: true } });
  let sequence = agg._max.sequence ?? 0;

  return async (stream, fields) => {
    const now = new Date();
    sequence += 1;
    await prisma.$transaction([
      prisma.onboardingJobEvent.create({
        data: {
          jobId,
          sequence,
          stream,
          type: fields.type ?? null,
          subtype: fields.subtype ?? null,
          level: fields.level ?? (stream === "stderr" ? "error" : null),
          text: boundedText(fields.text),
          data: boundedJson(fields.data),
          createdAt: now,
        },
      }),
      prisma.onboardingJob.update({
        where: { id: jobId },
        data: { eventCount: { increment: 1 }, lastEventAt: now },
      }),
    ]);
  };
}

// --- job processing --------------------------------------------------------

type SalonRow = {
  id: string;
  name: string;
  instagram: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  bookingTool: string;
};

/** Builds the CRM hints from the salon row (what `triggerOnboarding` used to pass inline). */
function buildHints(salon: SalonRow): OnboardingHints {
  return {
    crmSalonId: salon.id,
    salonName: salon.name,
    instagram: salon.instagram,
    instagramHandle: salon.instagram,
    address: salon.address,
    lat: salon.lat,
    lng: salon.lng,
    latitude: salon.lat,
    longitude: salon.lng,
    phone: salon.phone,
    contactName: salon.contactName,
    contactEmail: salon.contactEmail,
    bookingTool: salon.bookingTool,
  };
}

function resultStatus(status: string): "DONE" | "ALREADY_ONBOARDED" | "FAILED" {
  if (status === "success") return "DONE";
  if (status === "already_onboarded") return "ALREADY_ONBOARDED";
  return "FAILED";
}

/** Atomically claims a QUEUED job (→ PROCESSING) and returns it with its salon, or null if lost the race. */
async function claimJob(prisma: Prisma, id: string) {
  const claimed = await prisma.onboardingJob.updateMany({
    where: { id, status: "QUEUED" },
    data: { status: "PROCESSING", startedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  return prisma.onboardingJob.findUnique({
    where: { id },
    include: {
      salon: {
        select: {
          id: true,
          name: true,
          instagram: true,
          address: true,
          lat: true,
          lng: true,
          phone: true,
          contactName: true,
          contactEmail: true,
          bookingTool: true,
        },
      },
    },
  });
}

/** Maps a finished pipeline result onto the job row + backfills the salon's address/coords. */
async function finalizeJob(
  prisma: Prisma,
  encrypt: Pipeline["encrypt"],
  jobId: string,
  salonId: string,
  startedAt: Date,
  result: Awaited<ReturnType<Pipeline["createDisabledSalonAccount"]>>,
) {
  const finishedAt = new Date();
  await prisma.onboardingJob.update({
    where: { id: jobId },
    data: {
      status: resultStatus(result.status),
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      exitCode: result.status === "failed" ? 1 : 0,
      accountUid: result.ownerId ?? null,
      loginEmail: result.email ?? null,
      loginPassword: result.password ? encrypt(result.password) : null,
      sourceType: result.sourceType ?? null,
      serviceCount: result.serviceCount ?? null,
      agentCount: result.agentCount ?? null,
      warnings: result.warnings.length ? result.warnings : undefined,
      error: result.error ?? null,
    },
  });

  const salonData: { address?: string; lat?: number; lng?: number } = {};
  if (result.address) salonData.address = result.address;
  if (result.lat != null && result.lng != null) {
    salonData.lat = result.lat;
    salonData.lng = result.lng;
  }
  if (Object.keys(salonData).length > 0) {
    await prisma.salon.update({ where: { id: salonId }, data: salonData });
  }
}

async function processJob(prisma: Prisma, pipeline: Pipeline, id: string) {
  const job = await claimJob(prisma, id);
  if (!job || !job.salon) return;

  const startedAt = job.startedAt ?? new Date();
  const sourceUrl = job.sourceUrl;
  const emit = await makeEmitter(prisma, job.id);
  await emit("system", { type: "job_started", text: `onboarding ${sourceUrl}`, data: { sourceUrl, sourceType: job.sourceType } });

  try {
    // 1. Expand — deterministic Playwright reveal of all hidden services.
    const expanded = await pipeline.expandSalonPage(sourceUrl);
    await emit("system", {
      type: "expand_done",
      subtype: expanded.sourceType,
      text: `expanded ${expanded.sourceType} page (${expanded.html.length} bytes)`,
      data: { sourceType: expanded.sourceType, title: expanded.title, htmlBytes: expanded.html.length },
    });

    // 2. Extract — Haiku structured output from the trimmed HTML.
    const extract = await pipeline.extractSalon(expanded.html, expanded.sourceType, sourceUrl);
    await emit("system", {
      type: "extract_done",
      text: `extracted "${extract.salon.name}" — ${extract.services.length} service(s), ${extract.staff.length} staff`,
      data: {
        name: extract.salon.name,
        address: extract.salon.address,
        serviceCount: extract.services.length,
        staffCount: extract.staff.length,
      },
    });

    // 3. Create the salon account (Auth + userProfile + services + enrichment).
    // Per-job `config` (JSON column) carries P6 overrides — login creds, enable
    // flag, deposit, agent/review targets. Absent → legacy disabled behavior.
    const overrides = (job.config ?? undefined) as OnboardingOverrides | undefined;
    const result = await pipeline.createDisabledSalonAccount(extract, buildHints(job.salon), {
      url: sourceUrl,
      sourceType: expanded.sourceType,
    }, overrides);
    if (result.warnings.length) {
      await emit("stderr", { type: "warnings", level: "warn", text: result.warnings.join("\n"), data: result.warnings });
    }
    await emit("system", {
      type: "account_created",
      subtype: result.status,
      text: `${result.status}: ${result.email ?? "—"} (${result.serviceCount} service(s), ${result.agentCount} agent(s), ${result.reviewCount} review(s))`,
      data: {
        status: result.status,
        ownerId: result.ownerId,
        email: result.email,
        serviceCount: result.serviceCount,
        agentCount: result.agentCount,
        reviewCount: result.reviewCount,
        welcomeEmailSent: result.welcomeEmailSent,
      },
    });

    await finalizeJob(prisma, pipeline.encrypt, job.id, job.salonId, startedAt, result);
    await emit("system", { type: "job_exited", subtype: result.status, data: { exitCode: result.status === "failed" ? 1 : 0 } });
    console.log(`onboarded ${job.id} (${sourceUrl}): ${result.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit("stderr", { type: "job_error", level: "error", text: message });
    const finishedAt = new Date();
    await prisma.onboardingJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        exitCode: 1,
        error: message.slice(0, 2000),
      },
    });
    console.error(`failed ${job.id} (${sourceUrl}): ${message}`);
  }
}

async function processBatch(prisma: Prisma, pipeline: Pipeline) {
  const jobs = await prisma.onboardingJob.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: { id: true },
  });

  for (const job of jobs) {
    await processJob(prisma, pipeline, job.id);
  }

  console.log(`processed ${jobs.length} onboarding job(s)`);
}

/**
 * On worker startup, reclaim jobs a previous worker left stuck in PROCESSING
 * (it crashed mid-flight) by resetting them to QUEUED. Only safe for the
 * single long-running `--loop` worker that owns the queue, so it's gated on
 * loop mode. (Step P4.5.)
 */
async function requeueOrphans(prisma: Prisma) {
  const orphans = await prisma.onboardingJob.findMany({ where: { status: "PROCESSING" }, select: { id: true } });
  if (orphans.length === 0) return;
  await prisma.onboardingJob.updateMany({
    where: { status: "PROCESSING" },
    data: { status: "QUEUED", startedAt: null },
  });
  for (const { id } of orphans) {
    const emit = await makeEmitter(prisma, id);
    await emit("system", { type: "requeued", text: "worker restart: reset orphaned PROCESSING job to QUEUED" });
  }
  console.log(`requeued ${orphans.length} orphaned PROCESSING job(s)`);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const [{ expandSalonPage }, { extractSalon }, { createDisabledSalonAccount }, { encrypt }] = await Promise.all([
    import("../src/lib/onboarding/expand"),
    import("../src/lib/onboarding/extract"),
    import("../src/lib/onboarding/create-account"),
    import("../src/lib/crypto"),
  ]);
  const pipeline: Pipeline = { expandSalonPage, extractSalon, createDisabledSalonAccount, encrypt };

  if (!loop) {
    await processBatch(prisma, pipeline);
    return;
  }

  await requeueOrphans(prisma);
  console.log(`onboarding worker polling every ${pollMs / 1000}s`);
  while (true) {
    await processBatch(prisma, pipeline);
    await sleep(pollMs);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  });
