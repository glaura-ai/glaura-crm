/**
 * Transactional reminder sent shortly before a Stripe subscription trial ends.
 *
 * Stripe owns the timing through `customer.subscription.trial_will_end`.
 * Cloud Functions resolves the provider and forwards a small, authenticated
 * payload; the CRM owns the editable email template and the SMS relay.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { renderTemplate } from "@/lib/emailTemplates";

export const PRO_TRIAL_ENDING_TEMPLATE_KEY = "PRO_TRIAL_ENDING";

export const trialEndingRequestSchema = z.object({
  eventId: z.string().trim().min(1).max(255),
  providerId: z.string().trim().min(1).max(255),
  to: z.email(),
  phone: z.string().trim().max(40).optional().default(""),
  data: z.object({
    salonName: z.string().trim().min(1).max(190),
    planName: z.string().trim().min(1).max(120),
    trialEndsAt: z.iso.datetime(),
    billingUrl: z.url(),
  }),
}).superRefine((input, context) => {
  let url: URL;
  try {
    url = new URL(input.data.billingUrl);
  } catch {
    return;
  }
  if (url.protocol !== "https:" || !["pro.glaura.ai", "staging-pro.glaura.ai"].includes(url.hostname)) {
    context.addIssue({
      code: "custom",
      path: ["data", "billingUrl"],
      message: "billingUrl must use an approved Glaura Pro host",
    });
  }
});

export type TrialEndingData = z.infer<typeof trialEndingRequestSchema>["data"];

export type TrialEndingTemplate = {
  id?: string;
  subject: string;
  body: string;
  source: "database" | "file";
};

let trialEndingTemplateBody: string | null = null;

export function bundledTrialEndingTemplate(): TrialEndingTemplate {
  if (trialEndingTemplateBody == null) {
    trialEndingTemplateBody = readFileSync(
      fileURLToPath(new URL("../onboarding/templates/pro-trial-ending.html", import.meta.url)),
      "utf8",
    );
  }
  return {
    subject: "{{salon}} — votre essai Glaura se termine le {{trialEndDate}}",
    body: trialEndingTemplateBody,
    source: "file",
  };
}

export async function loadTrialEndingTemplate(
  prisma: Pick<PrismaClient, "emailTemplate">,
): Promise<TrialEndingTemplate> {
  try {
    const row = await prisma.emailTemplate.findFirst({
      where: { key: PRO_TRIAL_ENDING_TEMPLATE_KEY, archivedAt: null },
      select: { id: true, subject: true, body: true },
    });
    if (row?.body.trim()) return { ...row, source: "database" };
  } catch {
    // A missing template row must not suppress a billing reminder.
  }
  return bundledTrialEndingTemplate();
}

export function formatTrialEndDate(isoDate: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(isoDate));
}

export function renderTrialEndingEmail(
  data: TrialEndingData,
  template: TrialEndingTemplate = bundledTrialEndingTemplate(),
) {
  const trialEndDate = formatTrialEndDate(data.trialEndsAt);
  const values = {
    "{{trialEndDate}}": trialEndDate,
    "{{planName}}": data.planName,
    "{{billingUrl}}": data.billingUrl,
  };
  const salonDraft = { name: data.salonName, contactName: null, bookingUrl: null };
  return {
    subject: renderTemplate(template.subject, salonDraft, { format: "TEXT", values }),
    html: renderTemplate(template.body, salonDraft, { format: "HTML", values }),
    text: [
      "Bonjour,",
      `L'essai Glaura de ${data.salonName} se termine le ${trialEndDate}.`,
      `Votre abonnement ${data.planName} démarrera automatiquement avec le moyen de paiement enregistré.`,
      `Vous pouvez gérer ou résilier votre abonnement ici : ${data.billingUrl}`,
      "L'équipe Glaura — support@glaura.fr",
    ].join("\n\n"),
  };
}

export function trialEndingSmsBody(data: TrialEndingData): string {
  const trialEndDate = formatTrialEndDate(data.trialEndsAt);
  return `Glaura : l'essai de ${data.salonName} se termine le ${trialEndDate}. Votre abonnement démarrera automatiquement. Gérez-le ici : ${data.billingUrl}`;
}

export async function sendTrialEndingSms(phone: string, data: TrialEndingData): Promise<boolean> {
  const endpoint = process.env.GLAURA_SMS_SEND_URL?.trim();
  if (!endpoint || !phone.trim()) return false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ To: phone.trim(), Body: trialEndingSmsBody(data) }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return true;
      if (response.status !== 429 && response.status < 500) return false;
    } catch {
      // Timeout/network failures are retried within this request.
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return false;
}
