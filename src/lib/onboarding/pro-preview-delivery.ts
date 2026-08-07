import { FieldValue } from "firebase-admin/firestore";
import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/firebase-admin";
import {
  buildProPreviewUrl,
  hashProPreviewToken,
  loadProPreviewTemplate,
  proPreviewToken,
  renderProPreviewEmail,
  type ProPlanCode,
  type ProPreviewService,
} from "@/lib/onboarding/pro-preview";

const ACTIVATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function prepareAndNotifyProPreview(input: {
  prisma: PrismaClient;
  jobId: string;
  salonId: string;
  uid: string;
  email: string;
  phone: string;
  salonName: string;
  serviceCount: number;
  instagramHandle?: string | null;
  services?: readonly ProPreviewService[];
  planCode: ProPlanCode;
  trialPeriodDays: number;
  publicBaseUrl?: "https://glaura.ai" | "https://staging-1.glaura.ai";
}) {
  const secret = process.env.PRO_PREVIEW_TOKEN_SECRET ?? "";
  const token = proPreviewToken(input.jobId, secret);
  const tokenHash = hashProPreviewToken(token);
  const publicBase = input.publicBaseUrl ||
    process.env.GLAURA_PUBLIC_BASE_URL ||
    "https://glaura.ai";
  const previewUrl = buildProPreviewUrl(publicBase, token);
  const successUrl = `${previewUrl}?activated=1`;
  const db = getDb();
  const profileRef = db.collection("userProfile").doc(input.uid);
  const profile = await profileRef.get();
  const companyUserName = profile.get("companyUserName");
  if (!profile.exists || typeof companyUserName !== "string" || !companyUserName) {
    throw new Error(`Preview profile ${input.uid} has no companyUserName`);
  }
  // A user can restart the form and change plan while the first CRM job is
  // already running. The provisional profile is the latest server-authored
  // choice, so it wins over the queued job snapshot.
  const profilePlanCode = profile.get("proPlanCode");
  const planCode: ProPlanCode = profilePlanCode === "basic" || profilePlanCode === "reservation" ?
    profilePlanCode : input.planCode;
  const trialPeriodDays = planCode === "basic" ? 7 : 14;
  const profileImg = profile.get("profileImg");
  const salonImages = profile.get("salon_images");
  const heroImageUrl = typeof profileImg === "string" && profileImg.trim()
    ? profileImg.trim()
    : Array.isArray(salonImages) && typeof salonImages[0] === "string"
      ? salonImages[0]
      : null;
  const profileAddress = profile.get("address");

  const activationRef = db.collection("proActivationSessions").doc(tokenHash);
  const existing = await activationRef.get();
  const existingData = existing.data() ?? {};
  const now = Date.now();
  const status = typeof existingData.status === "string" ?
    existingData.status : "preview_ready";

  await activationRef.set({
    uid: input.uid,
    salonId: input.salonId,
    jobId: input.jobId,
    email: input.email,
    phone: input.phone,
    salonName: input.salonName,
    companyUserName,
    serviceCount: input.serviceCount,
    planCode,
    trialPeriodDays,
    status,
    createdAtMs: Number(existingData.createdAtMs) || now,
    expiresAtMs: Number(existingData.expiresAtMs) || now + ACTIVATION_TTL_MS,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // The checkout function reads this server-authored offer. No browser can
  // choose a Stripe price, trial, discount or return target.
  await profileRef.set({
    enable: false,
    isActive: false,
    available: false,
    proOnboardingStatus: "preview_ready",
    billingCheckoutOffer: {
      planCode,
      trialPeriodDays,
      successUrl,
      cancelUrl: previewUrl,
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const templateKey = `pro_preview:${input.jobId}`;
  const existingEmail = await input.prisma.emailJob.findFirst({
    where: { salonId: input.salonId, templateKey },
    select: { id: true },
  });
  let emailQueued = Boolean(existingEmail);
  if (!existingEmail && input.email.trim()) {
    const template = await loadProPreviewTemplate(input.prisma);
    const email = renderProPreviewEmail({
      previewUrl,
      salonName: input.salonName,
      serviceCount: input.serviceCount,
      instagramHandle: input.instagramHandle,
      heroImageUrl,
      address: typeof profileAddress === "string" ? profileAddress : null,
      services: input.services,
    }, template);
    await input.prisma.emailJob.create({
      data: {
        salonId: input.salonId,
        to: input.email.trim(),
        from: process.env.SMTP_FROM || "Glaura <support@glaura.fr>",
        templateId: template.id,
        templateKey,
        subject: email.subject,
        format: "HTML",
        body: email.html,
        bodyText: email.text,
        status: "QUEUED",
      },
    });
    emailQueued = true;
    await activationRef.set({ previewEmailQueuedAtMs: Date.now() }, { merge: true });
  }

  let smsSent = Boolean(existingData.previewSmsSentAtMs);
  if (!smsSent && input.phone.trim()) {
    smsSent = await sendPreviewSms(input.phone, input.salonName, previewUrl);
    if (smsSent) {
      await activationRef.set({ previewSmsSentAtMs: Date.now() }, { merge: true });
    }
  }

  return { previewUrl, tokenHash, emailQueued, smsSent };
}

async function sendPreviewSms(phone: string, salonName: string, previewUrl: string): Promise<boolean> {
  const endpoint = process.env.GLAURA_SMS_SEND_URL?.trim();
  if (!endpoint) return false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          To: phone.trim(),
          Body: `La page Glaura de ${salonName} est prête : ${previewUrl}`,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return true;
      if (response.status !== 429 && response.status < 500) return false;
    } catch {
      // A timeout/network failure is retryable; the final failure is recorded
      // on the onboarding job event stream for operations to follow up.
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return false;
}
