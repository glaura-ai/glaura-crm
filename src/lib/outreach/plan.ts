// Pure decision function for one outreach sequence: no I/O, the engine executes the result.
import { instagramReplyAllowed } from "@/lib/instagram-inbox/security";
import { instagramStepText, STEP1_AFTER_INBOUND_MS, STEP2_AFTER_START_MS, STEP3_AFTER_START_MS, type OutreachStopReason } from "./config";
import { inSendHours, latestSendSlot, nextSendSlot } from "./hours";
import { extractFrenchMobile } from "./phone";

export type PlanInput = {
  step: number; startedAt: Date; lastSentAt: Date | null; phone: string | null;
  lastInboundAt: Date | null; resolvedAt: Date | null;
  /** Current (non-stale) qualification of the conversation, or null. */
  qualification: string | null;
  /** Incoming messages the contact sent after `lastSentAt`, oldest first. */
  replies: { text: string; sentAt: Date }[];
  salon: { status: string; accountStatusLabel: string | null } | null;
  optedOut: boolean; now: Date; calendarUrl?: string;
};
export type OutreachPlan =
  | { kind: "stop"; reason: OutreachStopReason }
  | { kind: "send_instagram"; step: 0 | 1; text: string }
  | { kind: "send_whatsapp"; step: 2 | 3; template: 1 | 2 }
  | { kind: "create_task" }
  /** `phone` is a number the contact just gave; `ackAt` marks their reply as handled. */
  | { kind: "skip"; toStep: 2 | 3; nextRunAt: Date; phone?: string; ackAt?: Date }
  | { kind: "wait"; nextRunAt: Date }
  | { kind: "done" };

/** Safety margin before Instagram's 24h window closes (worker tick + send latency). */
const WINDOW_MARGIN_MS = 5 * 60 * 1000;
const at = (d: Date, ms: number) => new Date(d.getTime() + ms);

function stopReason(i: PlanInput): OutreachStopReason | null {
  if (i.salon?.status === "SIGNE" || i.salon?.status === "PAS_INTERESSE") return "SALON_CLOSED";
  if (i.salon?.accountStatusLabel === "demo_booked") return "DEMO_BOOKED";
  if (i.qualification === "FROID") return "COLD";
  if (i.resolvedAt) return "CONVERSATION_DONE";
  return null;
}

function step1(i: PlanInput): OutreachPlan {
  const skip: OutreachPlan = { kind: "skip", toStep: 2, nextRunAt: nextSendSlot(at(i.startedAt, STEP2_AFTER_START_MS)) };
  if (!i.lastInboundAt) return skip;
  const limit = at(i.lastInboundAt, 24 * 3600000 - WINDOW_MARGIN_MS);
  if (i.now >= limit) return skip;
  const base = new Date(Math.max(at(i.lastInboundAt, STEP1_AFTER_INBOUND_MS).getTime(), i.now.getTime()));
  const t = inSendHours(base) && base < limit ? base : latestSendSlot(limit, i.now);
  if (!t) return skip;
  return t <= i.now ? { kind: "send_instagram", step: 1, text: instagramStepText(1, { hasPhone: !!i.phone, calendarUrl: i.calendarUrl }) } : { kind: "wait", nextRunAt: t };
}

function whatsappStep(i: PlanInput, step: 2 | 3): OutreachPlan {
  const due = nextSendSlot(at(i.startedAt, step === 2 ? STEP2_AFTER_START_MS : STEP3_AFTER_START_MS));
  if (!i.phone) return step === 2 ? { kind: "skip", toStep: 3, nextRunAt: nextSendSlot(at(i.startedAt, STEP3_AFTER_START_MS)) } : due <= i.now ? { kind: "create_task" } : { kind: "wait", nextRunAt: due };
  return due <= i.now ? { kind: "send_whatsapp", step, template: step === 2 ? 1 : 2 } : { kind: "wait", nextRunAt: due };
}

export function planOutreach(i: PlanInput): OutreachPlan {
  const reason = stopReason(i);
  if (reason) return { kind: "stop", reason };
  if (i.step >= 4) return { kind: "done" };

  if (i.lastSentAt && i.replies.length) {
    const last = i.replies[i.replies.length - 1];
    const phone = i.phone ? null : extractFrenchMobile([last.text]);
    if (!phone) return { kind: "stop", reason: "REPLIED" };
    if (i.optedOut) return { kind: "stop", reason: "WHATSAPP_OPT_OUT" };
    return { kind: "skip", toStep: Math.max(i.step, 2) as 2 | 3, nextRunAt: nextSendSlot(i.now), phone, ackAt: last.sentAt };
  }
  if (i.step >= 2 && i.optedOut) return { kind: "stop", reason: "WHATSAPP_OPT_OUT" };

  if (i.step === 0) {
    if (instagramReplyAllowed(i.lastInboundAt, i.now)) return { kind: "send_instagram", step: 0, text: instagramStepText(0, { hasPhone: !!i.phone, calendarUrl: i.calendarUrl }) };
    return i.phone ? { kind: "skip", toStep: 2, nextRunAt: nextSendSlot(at(i.startedAt, STEP2_AFTER_START_MS)) } : { kind: "stop", reason: "SEND_FAILED" };
  }
  if (i.step === 1) return step1(i);
  return whatsappStep(i, i.step === 2 ? 2 : 3);
}
