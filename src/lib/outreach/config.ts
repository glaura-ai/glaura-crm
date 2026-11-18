// Shared contract for the Instagram → WhatsApp demo-booking sequence.
// The engine (plan/worker) and the inbox UI (actions/components) both build on it.
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
 * Steps, run in order. Delays (editable settings) are measured from `startedAt`, except step 1 which
 * must land inside Instagram's 24h window (measured from the last inbound).
 *  0 · Instagram — intro + calendar link (immediately).
 *  1 · Instagram — reminder, asks for a WhatsApp number (lastInboundAt + step1DelayHours).
 *  2 · WhatsApp template #1 (startedAt + step2DelayDays), skipped without a phone.
 *  3 · WhatsApp template #2, last call (startedAt + step3DelayDays); without a phone a
 *      SalesTask is created for the conversation's salon owner instead. Then DONE.
 */
export const OUTREACH_STEP_COUNT = 4;
export const OUTREACH_STEP_LABEL = ["Message Instagram", "Relance Instagram", "WhatsApp", "Dernier WhatsApp"] as const;

/** WhatsApp credentials (secrets stay in env; texts, templates and delays live in OutreachSettings). */
export function whatsappOutreachConfig(env = process.env) {
  const token = env.META_SYSTEM_USER_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_OUTREACH_PHONE_NUMBER_ID?.trim();
  return token && phoneNumberId ? { token, phoneNumberId, version: env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0" } : null;
}
