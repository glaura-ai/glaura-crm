/**
 * Post-demo activation hook, called by Cloud Functions after an admin clicks
 * « Activate » in goglow-admin. The caller has already enabled the Firestore
 * profile; this route only (a) emails the salon its login link and (b) marks
 * the CRM salon signed. Auth mirrors /api/transactional/booking-refund.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isBearerAuthorized } from "@/lib/bearer-auth";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/firebase-admin";
import { maybeSendMagicLinkEmail } from "@/lib/onboarding/magic-link";
import { proPortalUrlForStripeMode } from "@/lib/onboarding/pro-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  uid: z.string().min(1),
  email: z.string().email().optional(),
  salonName: z.string().optional(),
  isStripeLive: z.boolean().default(true),
});

/** The salon an onboarding job targeted this uid for, else the self-serve externalRef. */
async function findSalon(uid: string) {
  const job = await prisma.onboardingJob.findFirst({
    where: { config: { path: ["targetUid"], equals: uid } },
    orderBy: { createdAt: "desc" },
    select: { salonId: true },
  });
  const where = job ? { id: job.salonId } : { externalRef: `self_serve:${uid}` };
  return prisma.salon.findFirst({
    where,
    select: { id: true, name: true, contactEmail: true, signedAt: true },
  });
}

async function markSigned(salon: { id: string; signedAt: Date | null }) {
  const now = new Date();
  await prisma.salon.update({
    where: { id: salon.id },
    data: {
      status: "SIGNE",
      accountStatusLabel: "active",
      ...(salon.signedAt ? {} : { signedAt: now }),
      activatedAt: now,
    },
  });
  await prisma.activity
    .create({ data: { salonId: salon.id, type: "NOTE", notes: "Compte activé depuis l'admin" } })
    .catch(() => undefined);
}

export async function POST(req: NextRequest) {
  const secret = process.env.TRANSACTIONAL_EMAIL_SECRET;
  if (!secret?.trim()) {
    return NextResponse.json({ ok: false, error: "transactional_email_not_configured" }, { status: 503 });
  }
  if (!isBearerAuthorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const { uid, isStripeLive } = parsed.data;

  try {
    const salon = await findSalon(uid);
    let crmUpdated = false;
    let crmError: string | undefined;
    if (salon) {
      try {
        await markSigned(salon);
        crmUpdated = true;
      } catch (error) {
        crmError = error instanceof Error ? error.message : String(error);
        console.error("pro_activation_crm_update_failed", { uid, error: crmError });
      }
    }

    const email =
      parsed.data.email?.trim() ||
      (await getAuth().getUser(uid).then((u) => u.email ?? "").catch(() => "")) ||
      salon?.contactEmail ||
      "";
    const salonName = parsed.data.salonName?.trim() || salon?.name || undefined;

    const result = await maybeSendMagicLinkEmail({
      uid,
      email,
      salonName,
      proPortalUrl: proPortalUrlForStripeMode(isStripeLive),
      emailKind: "pro_activation",
    });
    if (!result.sent) {
      const error = result.error ?? result.skippedReason ?? "email_not_sent";
      return NextResponse.json({ ok: false, emailSent: false, crmUpdated, error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, emailSent: true, crmUpdated, ...(crmError ? { error: crmError } : {}) });
  } catch (error) {
    console.error("pro_activation_ready_failed", { uid, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false, error: "activation_failed" }, { status: 500 });
  }
}
