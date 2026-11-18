// Shared contract for the Instagram → WhatsApp demo-booking sequence.
// The engine (plan/worker) and the inbox UI (actions/components) both build on it.
import { proSalesCalendarUrl } from "@/lib/onboarding/pro-preview";

export const OUTREACH_STATUSES = ["ACTIVE", "STOPPED", "DONE"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const OUTREACH_STOP_REASONS = {
  REPLIED: "Le contact a répondu",
  COLD: "Lead qualifié froid",
  DEMO_BOOKED: "Démo réservée",
  SALON_CLOSED: "Salon signé ou pas intéressé",
  CONVERSATION_DONE: "Conversation marquée traitée",
  WHATSAPP_OPT_OUT: "Désinscrit de WhatsApp",
  MANUAL: "Arrêtée manuellement",
  SEND_FAILED: "Envoi impossible",
} as const;
export type OutreachStopReason = keyof typeof OUTREACH_STOP_REASONS;

/**
 * Steps, run in order. Delays are measured from `startedAt`, except step 1 which
 * must land inside Instagram's 24h window (measured from the last inbound).
 *  0 · Instagram — intro + calendar link (immediately).
 *  1 · Instagram — reminder, asks for a WhatsApp number (lastInboundAt + 20h).
 *  2 · WhatsApp template #1 (startedAt + 2 days), skipped without a phone.
 *  3 · WhatsApp template #2, last call (startedAt + 5 days); without a phone a
 *      SalesTask is created for the conversation's salon owner instead. Then DONE.
 */
export const OUTREACH_STEP_COUNT = 4;
export const OUTREACH_STEP_LABEL = ["Message Instagram", "Relance Instagram", "WhatsApp", "Dernier WhatsApp"] as const;
export const STEP1_AFTER_INBOUND_MS = 20 * 60 * 60 * 1000;
export const STEP2_AFTER_START_MS = 2 * 24 * 60 * 60 * 1000;
export const STEP3_AFTER_START_MS = 5 * 24 * 60 * 60 * 1000;
/** Never send outside French business hours (Paris time); push to the next 9:00. */
export const SEND_HOURS_PARIS = { start: 9, end: 20 } as const;

export function outreachEnabled(env = process.env) {
  return env.OUTREACH_ENABLED === "true";
}
/** When true, a CHAUD/TIEDE qualification enrols the conversation by itself. */
export function outreachAutoStart(env = process.env) {
  return env.OUTREACH_AUTO_START === "true";
}

export function whatsappOutreachConfig(env = process.env) {
  const token = env.META_SYSTEM_USER_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_OUTREACH_PHONE_NUMBER_ID?.trim();
  const template1 = env.OUTREACH_WA_TEMPLATE_1?.trim();
  const template2 = env.OUTREACH_WA_TEMPLATE_2?.trim();
  const language = env.OUTREACH_WA_TEMPLATE_LANG?.trim() || "fr";
  return token && phoneNumberId && template1 && template2
    ? { token, phoneNumberId, template1, template2, language, version: env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0" }
    : null;
}

// Glaura copy uses "tu". Keep each message short: it is a DM, not an email.
export function instagramStepText(step: 0 | 1, opts: { hasPhone: boolean; calendarUrl?: string }) {
  const link = opts.calendarUrl ?? proSalesCalendarUrl();
  if (step === 0) return `Merci pour ton message 🙌 Le plus simple pour voir si Glaura colle à ton salon : une démo de 20 min avec l’équipe. Choisis ton créneau ici 👉 ${link}`;
  return `Petit rappel 🙂 Tu peux réserver ta démo Glaura ici : ${link}${opts.hasPhone ? "" : "\nTu préfères qu’on continue sur WhatsApp ? Envoie-nous ton numéro."}`;
}
