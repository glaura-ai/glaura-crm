import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@/generated/prisma/client";
import { renderTemplate } from "@/lib/emailTemplates";

export type ProPlanCode = "basic" | "reservation";

export const PRO_PREVIEW_READY_TEMPLATE_KEY = "PRO_PREVIEW_READY";

export type ProPreviewTemplate = {
  id?: string;
  subject: string;
  body: string;
  source: "database" | "file";
};

let previewTemplateBody: string | null = null;

export function bundledProPreviewTemplate(): ProPreviewTemplate {
  if (previewTemplateBody == null) {
    previewTemplateBody = readFileSync(
      fileURLToPath(new URL("./templates/pro-preview-ready.html", import.meta.url)),
      "utf8",
    );
  }
  return {
    subject: "{{salon}} — votre page Glaura est prête",
    body: previewTemplateBody,
    source: "file",
  };
}

export async function loadProPreviewTemplate(
  prisma: Pick<PrismaClient, "emailTemplate">,
): Promise<ProPreviewTemplate> {
  try {
    const row = await prisma.emailTemplate.findFirst({
      where: { key: PRO_PREVIEW_READY_TEMPLATE_KEY, archivedAt: null },
      select: { id: true, subject: true, body: true },
    });
    if (row?.body.trim()) return { ...row, source: "database" };
  } catch {
    // A missing migration/database must never suppress the ready notification.
  }
  return bundledProPreviewTemplate();
}

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
  instagramHandle?: string | null;
}, template: ProPreviewTemplate = bundledProPreviewTemplate()) {
  const salon = input.salonName.trim() || "votre salon";
  const count = Math.max(0, Math.floor(input.serviceCount));
  const instagram = (input.instagramHandle ?? "").trim().replace(/^@+/, "");
  const values = {
    "{{lien_apercu}}": input.previewUrl,
    "{{nombre_prestations}}": String(count),
    "{{instagram_salon}}": instagram,
  };
  const salonDraft = { name: salon, contactName: null, bookingUrl: null };
  const subject = renderTemplate(template.subject, salonDraft, { format: "TEXT", values });
  const text = [
    `Bonjour,`,
    `La page Glaura de ${salon} est prête avec ${count} prestations.`,
    `Découvrez-la ici : ${input.previewUrl}`,
    `Vous pourrez la vérifier avant de choisir votre abonnement et de la mettre en ligne.`,
  ].join("\n\n");
  const html = renderTemplate(template.body, salonDraft, { format: "HTML", values });
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
