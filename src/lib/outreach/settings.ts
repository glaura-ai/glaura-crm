// Editable settings of the demo-booking sequence (singleton row "default",
// edited on /automatisations). The engine and the inbox read them at run time.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { proSalesCalendarUrl } from "@/lib/onboarding/pro-preview";

export const OUTREACH_SETTINGS_ID = "default";
/** Placeholders usable in the Instagram texts. */
export const PLACEHOLDERS = { link: "{lien_demo}", name: "{nom}" } as const;

const text = z.string().trim().min(1).max(1000);
const hour = z.coerce.number().int().min(0).max(23);
export const outreachSettingsSchema = z.object({
  enabled: z.boolean(),
  autoStart: z.boolean(),
  step0Text: text.refine(v => v.includes(PLACEHOLDERS.link), `Le premier message doit contenir ${PLACEHOLDERS.link}.`),
  step1Text: text.refine(v => v.includes(PLACEHOLDERS.link), `La relance doit contenir ${PLACEHOLDERS.link}.`),
  askPhoneText: text,
  // Step 1 must land inside Instagram's 24h reply window.
  step1DelayHours: z.coerce.number().int().min(1).max(23),
  step2DelayDays: z.coerce.number().int().min(1).max(30),
  step3DelayDays: z.coerce.number().int().min(2).max(60),
  sendHourStart: hour,
  sendHourEnd: z.coerce.number().int().min(1).max(24),
  template1: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Nom de modèle WhatsApp invalide (minuscules, chiffres, _)."),
  template2: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Nom de modèle WhatsApp invalide (minuscules, chiffres, _)."),
  templateLang: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Code langue invalide (ex. fr)."),
  calendarUrl: z.url({ protocol: /^https$/ }).nullable(),
}).refine(s => s.step3DelayDays > s.step2DelayDays, { message: "Le dernier WhatsApp doit partir après le premier.", path: ["step3DelayDays"] })
  .refine(s => s.sendHourEnd > s.sendHourStart, { message: "L’heure de fin doit être après l’heure de début.", path: ["sendHourEnd"] });

export type OutreachSettings = z.infer<typeof outreachSettingsSchema>;

// Glaura copy uses "tu". Keep each message short: it is a DM, not an email.
export const DEFAULT_OUTREACH_SETTINGS: OutreachSettings = {
  enabled: false,
  autoStart: false,
  step0Text: "Merci pour ton message 🙌 Le plus simple pour voir si Glaura colle à ton salon : une démo de 20 min avec l’équipe. Choisis ton créneau ici 👉 {lien_demo}",
  step1Text: "Petit rappel 🙂 Tu peux réserver ta démo Glaura ici : {lien_demo}",
  askPhoneText: "Tu préfères qu’on continue sur WhatsApp ? Envoie-nous ton numéro.",
  step1DelayHours: 20,
  step2DelayDays: 2,
  step3DelayDays: 5,
  sendHourStart: 9,
  sendHourEnd: 20,
  template1: "glaura_demo_invite",
  template2: "glaura_demo_last_call",
  templateLang: "fr",
  calendarUrl: null,
};

export async function getOutreachSettings(): Promise<OutreachSettings> {
  const row = await prisma.outreachSettings.findUnique({ where: { id: OUTREACH_SETTINGS_ID } });
  if (!row) return DEFAULT_OUTREACH_SETTINGS;
  const parsed = outreachSettingsSchema.safeParse(row);
  return parsed.success ? parsed.data : { ...DEFAULT_OUTREACH_SETTINGS, enabled: false };
}

export async function saveOutreachSettings(settings: OutreachSettings, userId: string) {
  const data = { ...outreachSettingsSchema.parse(settings), updatedById: userId };
  await prisma.outreachSettings.upsert({ where: { id: OUTREACH_SETTINGS_ID }, create: { id: OUTREACH_SETTINGS_ID, ...data }, update: data });
}

/** On only when switched on in the UI and not killed by OUTREACH_ENABLED=false on the host. */
export function outreachActive(settings: Pick<OutreachSettings, "enabled">, env = process.env) {
  return settings.enabled && env.OUTREACH_ENABLED !== "false";
}

export function calendarUrlOf(settings: Pick<OutreachSettings, "calendarUrl">) {
  return settings.calendarUrl || proSalesCalendarUrl();
}

export function renderOutreachText(template: string, vars: { link: string; name: string }) {
  return template.replaceAll(PLACEHOLDERS.link, vars.link).replaceAll(PLACEHOLDERS.name, vars.name);
}
