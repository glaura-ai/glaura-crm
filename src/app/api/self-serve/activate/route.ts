import { timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuth, getDb } from "@/lib/firebase-admin";
import { maybeSendMagicLinkEmail } from "@/lib/onboarding/magic-link";
import {
  proPortalUrlForStripeMode,
  subscriptionMatchesActivation,
} from "@/lib/onboarding/pro-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  uid: z.string().min(1),
  // Older production portal images do not send this field. Defaulting to live
  // preserves that rollout path; staging always sends false explicitly.
  isStripeLive: z.boolean().default(true),
});

const CLAIM_STALE_MS = 2 * 60 * 1000;
const CLAIMABLE_STATUSES = new Set([
  "preview_ready",
  "payment_pending",
  "activation_pending",
  "activation_email_failed",
  "activation_error",
]);

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const db = getDb();
  const activationRef = db.collection("proActivationSessions").doc(parsed.data.tokenHash);
  const activation = await activationRef.get();
  const data = activation.data();
  if (!activation.exists || !data || data.uid !== parsed.data.uid) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const expiresAtMs = Number(data.expiresAtMs);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });
  }
  if (data.status === "activated") {
    return NextResponse.json({ ok: true, status: "activated" });
  }
  const planCode = data.planCode === "basic" || data.planCode === "reservation" ?
    data.planCode : null;
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const salonName = typeof data.salonName === "string" ? data.salonName.trim() : "";
  const salonId = typeof data.salonId === "string" ? data.salonId : "";
  if (!planCode || !email || !salonId) {
    return NextResponse.json({ ok: false, error: "invalid_activation" }, { status: 409 });
  }

  const profileRef = db.collection("userProfile").doc(parsed.data.uid);
  const profile = await profileRef.get();
  if (!profile.exists || !subscriptionMatchesActivation(
    profile.data() ?? {},
    planCode,
    parsed.data.isStripeLive,
  )) {
    return NextResponse.json({ ok: false, error: "payment_required" }, { status: 402 });
  }

  const claimed = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(activationRef);
    const currentData = current.data();
    if (!current.exists || !currentData || currentData.uid !== parsed.data.uid) return "not_found";
    if (currentData.status === "activated") return "activated";
    const claimedAtMs = Number(currentData.activationClaimedAtMs);
    if (currentData.status === "activating" && claimedAtMs + CLAIM_STALE_MS > Date.now()) {
      return "activating";
    }
    if (currentData.status !== "activating" && !CLAIMABLE_STATUSES.has(String(currentData.status))) {
      return "not_ready";
    }
    transaction.set(activationRef, {
      status: "activating",
      activationClaimedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return "claimed";
  });

  if (claimed === "activated") return NextResponse.json({ ok: true, status: "activated" });
  if (claimed === "activating") {
    return NextResponse.json({ ok: true, status: "activating" }, { status: 202 });
  }
  if (claimed !== "claimed") {
    return NextResponse.json({ ok: false, error: claimed }, { status: 409 });
  }

  try {
    await Promise.all([
      getAuth().updateUser(parsed.data.uid, { disabled: false }),
      profileRef.set({
        enable: true,
        isActive: true,
        available: true,
        proOnboardingStatus: "activated",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      prisma.salon.update({
        where: { id: salonId },
        data: {
          status: "SIGNE",
          accountStatusLabel: "active",
          signedAt: new Date(),
          activatedAt: new Date(),
        },
      }),
    ]);

    const emailResult = await maybeSendMagicLinkEmail({
      uid: parsed.data.uid,
      email,
      salonName,
      proPortalUrl: proPortalUrlForStripeMode(parsed.data.isStripeLive),
      emailKind: "pro_activation",
    });
    if (!emailResult.sent) {
      await activationRef.set({
        status: "activation_email_failed",
        activationError: emailResult.error ?? emailResult.skippedReason ?? "email_not_sent",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return NextResponse.json({ ok: false, error: "activation_email_failed" }, { status: 502 });
    }

    await activationRef.set({
      status: "activated",
      activatedAtMs: Date.now(),
      activationError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return NextResponse.json({ ok: true, status: "activated" });
  } catch (error) {
    await activationRef.set({
      status: "activation_error",
      activationError: error instanceof Error ? error.message : String(error),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => undefined);
    return NextResponse.json({ ok: false, error: "activation_failed" }, { status: 500 });
  }
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.SELF_SERVE_ONBOARD_SECRET?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!expected || !presented) return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
