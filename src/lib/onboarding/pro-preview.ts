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

export type ProPreviewService = {
  name: string;
  price: number;
  durationMinutes?: number | null;
};

const FALLBACK_HERO_IMAGE = "https://glaura.ai/images/pro/network-rouge-paris.webp";

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
  heroImageUrl?: string | null;
  address?: string | null;
  services?: readonly ProPreviewService[];
}, template: ProPreviewTemplate = bundledProPreviewTemplate()) {
  const salon = input.salonName.trim() || "votre salon";
  const count = Math.max(0, Math.floor(input.serviceCount));
  const instagram = (input.instagramHandle ?? "").trim().replace(/^@+/, "");
  const services = previewServices(input.services);
  const values = {
    "{{lien_apercu}}": input.previewUrl,
    "{{nombre_prestations}}": String(count),
    "{{instagram_salon}}": instagram,
    "{{image_salon}}": safeHeroImageUrl(input.heroImageUrl),
    "{{adresse_salon}}": input.address?.trim() || "Votre salon",
    "{{prestation_1}}": services[0].name,
    "{{prix_prestation_1}}": formatPrice(services[0].price),
    "{{duree_prestation_1}}": formatDuration(services[0].durationMinutes),
    "{{prestation_2}}": services[1].name,
    "{{prix_prestation_2}}": formatPrice(services[1].price),
    "{{duree_prestation_2}}": formatDuration(services[1].durationMinutes),
    "{{prestation_3}}": services[2].name,
    "{{prix_prestation_3}}": formatPrice(services[2].price),
    "{{duree_prestation_3}}": formatDuration(services[2].durationMinutes),
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

function previewServices(input?: readonly ProPreviewService[]): [ProPreviewService, ProPreviewService, ProPreviewService] {
  const provided = (input ?? [])
    .filter((service) => service.name.trim())
    .slice(0, 3)
    .map((service) => ({
      name: service.name.trim(),
      price: Number.isFinite(service.price) ? Math.max(0, service.price) : 0,
      durationMinutes: service.durationMinutes,
    }));
  const fallbacks: ProPreviewService[] = [
    { name: "Vos prestations", price: 0, durationMinutes: null },
    { name: "Réservation en ligne", price: 0, durationMinutes: null },
    { name: "Catalogue personnalisé", price: 0, durationMinutes: null },
  ];
  return [0, 1, 2].map((index) => provided[index] ?? fallbacks[index]) as [
    ProPreviewService,
    ProPreviewService,
    ProPreviewService,
  ];
}

function safeHeroImageUrl(value?: string | null): string {
  try {
    const url = new URL(value?.trim() || FALLBACK_HERO_IMAGE);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : FALLBACK_HERO_IMAGE;
  } catch {
    return FALLBACK_HERO_IMAGE;
  }
}

function formatPrice(price: number): string {
  if (!(price > 0)) return "Sur devis";
  const amount = Number.isInteger(price) ? String(price) : price.toFixed(2).replace(".", ",");
  return `${amount} €`;
}

function formatDuration(minutes?: number | null): string {
  if (!minutes || minutes <= 0) return "Réservable en ligne";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${remainder} min`;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder}`;
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
