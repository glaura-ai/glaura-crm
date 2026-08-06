/**
 * Self-serve onboarding task API.
 *
 * A service-to-service endpoint the SP portal calls when a salon finishes the
 * self-serve wizard. The portal has already created the Firebase account and a
 * minimal LIVE `userProfile`; this endpoint records the salon in the CRM and
 * enqueues the SAME `OnboardingJob` the concierge `triggerOnboarding` action
 * creates — but in ENRICH mode, so the worker attaches the scraped catalog onto
 * the portal-created account instead of provisioning a new one.
 *
 * Auth is a shared secret (`SELF_SERVE_ONBOARD_SECRET`) presented as
 * `Authorization: Bearer <secret>` and compared in constant time. This is NOT a
 * next-auth session route — it deliberately bypasses the SIGNE gate that guards
 * the concierge flow.
 *
 * See docs/product/32-self-serve-onboarding-implementation.md §3a.
 */

import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizeInstagramHandle } from "@/lib/instagram";
import { slugify } from "@/lib/slugs";
import type { OnboardingOverrides } from "@/lib/onboarding";
import type { $Enums } from "@/generated/prisma/client";

type BookingTool = $Enums.BookingTool;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  /**
   * Firebase uid of an account the portal already created → ENRICH mode.
   * Omit it → CREATE mode: the worker provisions the live account itself
   * (self-serve form flow) and sends the passwordless magic-link email.
   */
  targetUid: z.string().min(1).optional(),
  /** Salon login email — CRM contact + job trace + account login. */
  email: z.string().email(),
  /** Contact person's name (create mode → account displayName hint). */
  contactName: z.string().trim().optional(),
  /** Display name → Salon.name and the unique CRM slug. */
  salonName: z.string().min(1),
  /** Booking-page URL to scrape (Planity/Treatwell/Booksy/site). */
  bookingUrl: z.string().url(),
  /** Handle, @handle or a pasted profile URL — stored as a bare handle. */
  instagramHandle: z.string().trim().max(500).optional().transform(normalizeInstagramHandle),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  /** Example agents to synthesize when the scrape finds no real staff. */
  agentCount: z.number().int().min(0).max(50).optional(),
  /** Curated 5★ reviews to seed. Self-serve default is 0 (real reviews only). */
  reviewTarget: z.number().int().min(0).max(500).optional(),
  activationPreview: z.boolean().optional().default(false),
  planCode: z.enum(["basic", "reservation"]).optional(),
  trialPeriodDays: z.number().int().min(1).max(30).optional(),
  /** Origin is selected by the trusted portal environment before OAuth. Keep
   * the allowlist explicit so notification links can never become an open
   * redirect if this service-to-service payload is malformed. */
  publicBaseUrl: z.enum(["https://glaura.ai", "https://staging-1.glaura.ai"]).optional(),
}).superRefine((body, context) => {
  if (body.activationPreview && (!body.targetUid || !body.planCode || !body.trialPeriodDays)) {
    context.addIssue({
      code: "custom",
      message: "activationPreview requires targetUid, planCode and trialPeriodDays",
      path: ["activationPreview"],
    });
  }
});

/** Maps a booking-page host to its CRM BookingTool + worker sourceType string. */
function detectBookingTool(url: string): { bookingTool: BookingTool; sourceType: string } {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (host.includes("planity")) return { bookingTool: "PLANITY", sourceType: "planity" };
  if (host.includes("treatwell")) return { bookingTool: "TREATWELL", sourceType: "treatwell" };
  if (host.includes("booksy")) return { bookingTool: "BOOKSY", sourceType: "booksy" };
  if (host.includes("acuity") || host.includes("acuityscheduling")) return { bookingTool: "ACUITY", sourceType: "acuity" };
  if (host.includes("fresha")) return { bookingTool: "FRESHA", sourceType: "fresha" };
  return { bookingTool: "SITE", sourceType: "generic" };
}

/** Constant-time bearer-secret check; false when unconfigured or mismatched. */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.SELF_SERVE_ONBOARD_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Reserves the first free Salon slug starting at `base`, then `base-1`, … */
async function reserveSalonSlug(base: string): Promise<string> {
  const root = base || "salon";
  for (let i = 0; i < 500; i++) {
    const candidate = i === 0 ? root : `${root}-${i}`;
    const existing = await prisma.salon.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  throw new Error(`Could not reserve a free Salon slug for base "${base}"`);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const { bookingTool, sourceType } = detectBookingTool(body.bookingUrl);
  const isEnrich = Boolean(body.targetUid);

  // Idempotency key: the portal uid in enrich mode, else the login email in
  // create mode. A retry re-enqueues against the same Salon row, never a dupe.
  const externalRef = isEnrich ? `self_serve:${body.targetUid}` : `self_serve_email:${body.email.toLowerCase()}`;
  const existingSalon = await prisma.salon.findFirst({
    where: { externalRef },
    select: { id: true },
  });

  // Enrich: attach the catalog onto the portal-created account.
  // Create: the worker provisions the live account + sends the magic-link email.
  const config: OnboardingOverrides = isEnrich
    ? {
        mode: "enrich",
        targetUid: body.targetUid,
        loginEmail: body.email,
        enable: body.activationPreview ? false : true,
        agentCount: body.agentCount ?? 0,
        reviewTarget: body.reviewTarget ?? 0,
        activationPreview: body.activationPreview,
        planCode: body.planCode,
        trialPeriodDays: body.trialPeriodDays,
        publicBaseUrl: body.publicBaseUrl,
      }
    : {
        loginEmail: body.email,
        enable: true,
        agentCount: body.agentCount ?? 0,
        reviewTarget: body.reviewTarget ?? 0,
        magicLinkSignIn: true,
      };

  try {
    const salonId = existingSalon?.id
      ? (
          await prisma.salon.update({
            where: { id: existingSalon.id },
            data: {
              name: body.salonName,
              phone: body.phone ?? null,
              contactName: body.contactName ?? null,
              contactEmail: body.email,
              instagram: body.instagramHandle ?? null,
              bookingTool,
              bookingUrl: body.bookingUrl,
              status: body.activationPreview ? "INTERESSE" : "SIGNE",
              accountStatusLabel: body.activationPreview ? "pro_preview" : "self_serve",
            },
            select: { id: true },
          })
        ).id
      : (
          await prisma.salon.create({
            data: {
              name: body.salonName,
              slug: await reserveSalonSlug(slugify(body.salonName)),
              address: body.address ?? null,
              phone: body.phone ?? null,
              contactName: body.contactName ?? null,
              contactEmail: body.email,
              instagram: body.instagramHandle ?? null,
              bookingTool,
              bookingUrl: body.bookingUrl,
              source: "IMPORT",
              externalRef,
              status: body.activationPreview ? "INTERESSE" : "SIGNE",
              accountStatusLabel: body.activationPreview ? "pro_preview" : "self_serve",
            },
            select: { id: true },
          })
        ).id;

    // A Meta callback retry must not enqueue a second scrape/build. Return the
    // active or completed preview job for this uid/source instead.
    if (body.activationPreview) {
      const recent = await prisma.onboardingJob.findMany({
        where: {
          salonId,
          sourceUrl: body.bookingUrl,
          status: { in: ["QUEUED", "PROCESSING", "DONE"] },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, config: true },
      });
      const duplicate = recent.find((candidate) => {
        const value = candidate.config;
        return Boolean(value && typeof value === "object" &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).activationPreview === true);
      });
      if (duplicate) {
        return NextResponse.json({ jobId: duplicate.id, salonId }, { status: 202 });
      }
    }

    const job = await prisma.onboardingJob.create({
      data: {
        salonId,
        sourceUrl: body.bookingUrl,
        sourceType,
        status: "QUEUED",
        config,
        loginEmail: body.email,
      },
      select: { id: true },
    });

    return NextResponse.json({ jobId: job.id, salonId }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: "enqueue_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "missing_jobId" }, { status: 400 });
  }

  const job = await prisma.onboardingJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      serviceCount: true,
      agentCount: true,
      accountUid: true,
      error: true,
      startedAt: true,
      finishedAt: true,
      events: {
        orderBy: { sequence: "desc" },
        take: 1,
        select: { text: true, type: true, level: true, createdAt: true },
      },
    },
  });
  if (!job) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { events, ...rest } = job;
  return NextResponse.json({ ...rest, lastEvent: events[0] ?? null });
}
