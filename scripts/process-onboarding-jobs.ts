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
  emailAlreadyRegistered: typeof import("../src/lib/onboarding/create-account").emailAlreadyRegistered;
  duplicateEmailReason: typeof import("../src/lib/onboarding/create-account").duplicateEmailReason;
  encrypt: typeof import("../src/lib/crypto").encrypt;
  onboardSalonReels: typeof import("../src/lib/onboarding/reels").onboardSalonReels;
  prepareAndNotifyProPreview: typeof import("../src/lib/onboarding/pro-preview-delivery").prepareAndNotifyProPreview;
  evaluateProSalonIdentity: typeof import("../src/lib/onboarding/pro-identity").evaluateProSalonIdentity;
  isProIdentityTestBypassAllowed: typeof import("../src/lib/onboarding/pro-identity").isProIdentityTestBypassAllowed;
  holdProProfileForIdentityReview: typeof import("../src/lib/onboarding/pro-identity-review").holdProProfileForIdentityReview;
  claimProBookingUrl: typeof import("../src/lib/onboarding/pro-booking-claim").claimProBookingUrl;
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

/**
 * Best-effort: seed the salon's top Instagram reels into its video feed after
 * account creation. Gated by ONBOARDING_REELS_ENABLED (default off) so it stays
 * dormant until validated on the VPS. Any miss or failure is emitted as an
 * event and swallowed — reels must never fail an onboarding job.
 */
async function seedReelsForJob(
  emit: Emit,
  salon: SalonRow,
  ownerId: string | null | undefined,
  onboardSalonReels: Pipeline["onboardSalonReels"],
) {
  if (process.env.ONBOARDING_REELS_ENABLED !== "true") {
    await emit("system", { type: "reels_skipped", text: "reels désactivés (ONBOARDING_REELS_ENABLED)" });
    return;
  }
  if (!ownerId) {
    await emit("system", { type: "reels_skipped", text: "pas d'ownerId (compte non créé)" });
    return;
  }
  const handle = salon.instagram?.trim();
  if (!handle) {
    await emit("system", { type: "reels_skipped", text: "pas de handle Instagram" });
    return;
  }
  if (!(process.env.IG_GRAPH_TOKEN && process.env.IG_GRAPH_USER_ID && process.env.ONBOARDING_SEED_SECRET)) {
    await emit("stderr", {
      type: "reels_skipped",
      level: "warn",
      text: "backend reels non configuré (IG_GRAPH_TOKEN / IG_GRAPH_USER_ID / ONBOARDING_SEED_SECRET)",
    });
    return;
  }

  try {
    const lines: string[] = [];
    const result = await onboardSalonReels({ handle, uid: ownerId, limit: 5 }, (m) => lines.push(m));
    await emit("system", {
      type: "reels_done",
      text:
        `reels @${result.handle}: ${result.resolved}/${result.candidates} résolus` +
        (result.seed ? `, ${result.seed.synced} uploadé(s)` : ""),
      data: { handle: result.handle, candidates: result.candidates, resolved: result.resolved, seed: result.seed, log: lines },
    });
  } catch (error) {
    await emit("stderr", { type: "reels_error", level: "warn", text: error instanceof Error ? error.message : String(error) });
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
    // Per-job `config` (JSON column) carries P6 overrides — login creds, enable
    // flag, mode, deposit, agent/review targets. Absent → legacy disabled behavior.
    const overrides = (job.config ?? undefined) as OnboardingOverrides | undefined;

    // 0. Fast-fail create-mode email collisions BEFORE the expensive scrape/LLM.
    // Enrich mode reuses an existing account, so it never collides here.
    const createLogin = overrides?.mode === "enrich" ? null : overrides?.loginEmail?.trim();
    if (createLogin && (await pipeline.emailAlreadyRegistered(createLogin))) {
      const reason = pipeline.duplicateEmailReason(createLogin);
      const finishedAt = new Date();
      await emit("system", {
        type: "account_created",
        subtype: "failed",
        level: "error",
        text: reason,
        data: { status: "failed", reason: "duplicate_email", email: createLogin },
      });
      await prisma.onboardingJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          exitCode: 1,
          loginEmail: createLogin,
          error: reason,
        },
      });
      await emit("system", { type: "job_exited", subtype: "failed", data: { exitCode: 1, reason: "duplicate_email" } });
      console.log(`onboarded ${job.id} (${sourceUrl}): failed (duplicate_email, no scrape)`);
      return;
    }

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

    // A verified OAuth handle proves control of that Instagram account, not
    // ownership of the business behind an arbitrary booking URL. Cross-check
    // Meta's identity against the freshly extracted salon before writing any
    // catalogue or issuing a private preview/Stripe link.
    if (overrides?.activationPreview && overrides.targetUid) {
      const verifiedInstagramHandle = overrides.verifiedInstagramHandle ?? job.salon.instagram ?? "";
      const testBypass = pipeline.isProIdentityTestBypassAllowed(
        verifiedInstagramHandle,
        process.env.PRO_IDENTITY_TEST_BYPASS_HANDLES,
      );
      let identity = pipeline.evaluateProSalonIdentity({
        bookingSalonName: extract.salon.name,
        bookingUrl: sourceUrl,
        instagramUsername: verifiedInstagramHandle,
        instagramDisplayName: overrides.verifiedInstagramDisplayName,
      }, { bypassAllChecks: testBypass });
      if (identity.status === "verified") {
        const claim = await pipeline.claimProBookingUrl(
          prisma,
          job.salonId,
          identity.bookingClaim,
          { bypass: testBypass },
        );
        if (!claim.claimed) {
          identity = {
            ...identity,
            status: "review_required",
            signals: [...identity.signals, "booking_claim_conflict"],
          };
        }
      }
      await emit("system", {
        type: "identity_checked",
        subtype: identity.status,
        level: identity.status === "verified" ? undefined : "warn",
        text: identity.status === "verified"
          ? `identité salon confirmée (${identity.signals.join(", ")})`
          : `vérification manuelle requise (score ${identity.score}/${identity.requiredScore})`,
        data: identity,
      });

      if (identity.status === "review_required") {
        const finishedAt = new Date();
        await Promise.all([
          pipeline.holdProProfileForIdentityReview(overrides.targetUid, identity),
          prisma.salon.update({
            where: { id: job.salonId },
            data: {
              name: extract.salon.name,
              accountStatusLabel: "identity_review",
              bookingUrlNormalized: null,
            },
          }),
          prisma.onboardingJob.update({
            where: { id: job.id },
            data: {
              status: "REVIEW_REQUIRED",
              finishedAt,
              durationMs: finishedAt.getTime() - startedAt.getTime(),
              exitCode: 0,
              accountUid: overrides.targetUid,
              warnings: [{ code: "identity_review_required", ...identity }],
              error: null,
            },
          }),
        ]);
        await emit("system", {
          type: "job_exited",
          subtype: "review_required",
          data: { exitCode: 0, reason: "identity_review_required" },
        });
        console.log(`onboarded ${job.id} (${sourceUrl}): identity review required`);
        return;
      }
    }

    // 3. Create the salon account (Auth + userProfile + services + enrichment).
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

    const previewSalonName = overrides?.activationPreview && extract.salon.name?.trim()
      ? extract.salon.name.trim()
      : job.salon.name;
    if (previewSalonName !== job.salon.name) {
      await prisma.salon.update({
        where: { id: job.salonId },
        data: { name: previewSalonName },
      });
    }

    await finalizeJob(prisma, pipeline.encrypt, job.id, job.salonId, startedAt, result);

    if (result.status === "success" && overrides?.activationPreview && result.ownerId) {
      try {
        const preview = await pipeline.prepareAndNotifyProPreview({
          prisma,
          jobId: job.id,
          salonId: job.salonId,
          uid: result.ownerId,
          email: job.salon.contactEmail ?? result.email ?? "",
          phone: job.salon.phone ?? "",
          salonName: previewSalonName,
          serviceCount: result.serviceCount,
          instagramHandle: job.salon.instagram,
          services: extract.services.map((service) => ({
            name: service.service_name,
            price: service.service_price,
            durationMinutes: service.duration_minutes,
          })),
          planCode: overrides.planCode === "basic" ? "basic" : "reservation",
          trialPeriodDays: overrides.trialPeriodDays ?? 14,
          publicBaseUrl: overrides.publicBaseUrl ?? undefined,
        });
        await emit("system", {
          type: "preview_ready",
          text: `aperçu prêt; email ${preview.emailQueued ? "en file" : "absent"}, SMS ${preview.smsSent ? "envoyé" : "non envoyé"}`,
          data: { emailQueued: preview.emailQueued, smsSent: preview.smsSent },
        });
      } catch (error) {
        await emit("stderr", {
          type: "preview_notification_failed",
          level: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Supplementary: seed the salon's Instagram reels into its video feed.
    // Never affects job status — reels are best-effort and fail soft.
    await seedReelsForJob(emit, job.salon, result.ownerId, pipeline.onboardSalonReels);

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
  const [{ expandSalonPage }, { extractSalon }, createAccountMod, { encrypt }, { onboardSalonReels }, previewMod, identityMod, identityReviewMod, bookingClaimMod] =
    await Promise.all([
      import("../src/lib/onboarding/expand"),
      import("../src/lib/onboarding/extract"),
      import("../src/lib/onboarding/create-account"),
      import("../src/lib/crypto"),
      import("../src/lib/onboarding/reels"),
      import("../src/lib/onboarding/pro-preview-delivery"),
      import("../src/lib/onboarding/pro-identity"),
      import("../src/lib/onboarding/pro-identity-review"),
      import("../src/lib/onboarding/pro-booking-claim"),
    ]);
  const pipeline: Pipeline = {
    expandSalonPage,
    extractSalon,
    createDisabledSalonAccount: createAccountMod.createDisabledSalonAccount,
    emailAlreadyRegistered: createAccountMod.emailAlreadyRegistered,
    duplicateEmailReason: createAccountMod.duplicateEmailReason,
    encrypt,
    onboardSalonReels,
    prepareAndNotifyProPreview: previewMod.prepareAndNotifyProPreview,
    evaluateProSalonIdentity: identityMod.evaluateProSalonIdentity,
    isProIdentityTestBypassAllowed: identityMod.isProIdentityTestBypassAllowed,
    holdProProfileForIdentityReview: identityReviewMod.holdProProfileForIdentityReview,
    claimProBookingUrl: bookingClaimMod.claimProBookingUrl,
  };

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
