import { createHash, createHmac } from "node:crypto";

export type ProPlanCode = "basic" | "reservation";

export function proPortalUrlForStripeMode(isLive: boolean): string {
  return isLive ? "https://pro.glaura.ai" : "https://staging-pro.glaura.ai";
}

export function proPreviewToken(jobId: string, secret: string): string {
  if (secret.trim().length < 32) {
    throw new Error("PRO_PREVIEW_TOKEN_SECRET must contain at least 32 characters");
  }
  return createHmac("sha256", secret).update(`pro-preview:${jobId}`).digest("base64url");
}

export function hashProPreviewToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildProPreviewUrl(baseUrl: string, token: string): string {
  const url = new URL(`/pro/preview/${encodeURIComponent(token)}`, baseUrl);
  return url.toString();
}

export function renderProPreviewEmail(input: {
  previewUrl: string;
  salonName: string;
  serviceCount: number;
}) {
  const salon = input.salonName.trim() || "votre salon";
  const count = Math.max(0, Math.floor(input.serviceCount));
  const subject = `${salon} — votre page Glaura est prête`;
  const text = [
    `Bonjour,`,
    `La page Glaura de ${salon} est prête avec ${count} prestations.`,
    `Découvrez-la ici : ${input.previewUrl}`,
    `Vous pourrez la vérifier avant de choisir votre abonnement et de la mettre en ligne.`,
  ].join("\n\n");
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#191919">
      <h1 style="font-size:28px">Votre page est prête.</h1>
      <p>Nous avons préparé la page de <strong>${escapeHtml(salon)}</strong> avec ${count} prestations.</p>
      <p style="margin:30px 0"><a href="${escapeHtml(input.previewUrl)}" style="background:#e45745;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:700">Voir ma page</a></p>
      <p>Vous pourrez la vérifier avant de choisir votre abonnement et de la mettre en ligne.</p>
    </div>
  `.trim();
  return { subject, text, html };
}

export function subscriptionMatchesActivation(
  profile: Record<string, unknown>,
  expectedPlanCode: ProPlanCode,
  expectedIsLive = true,
): boolean {
  const id = text(profile.stripeSubscriptionId);
  const status = text(profile.stripeSubscriptionStatus);
  const planCode = text(profile.stripeSubscriptionPlanCode);
  return Boolean(id) &&
    profile.stripeSubscriptionIsLive === expectedIsLive &&
    (status === "active" || status === "trialing") &&
    planCode === expectedPlanCode;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
