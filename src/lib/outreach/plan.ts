// Pure decision function for one outreach sequence: no I/O, the engine executes the result.
import { instagramReplyAllowed } from "@/lib/instagram-inbox/security";
import type { OutreachStopReason } from "./config";
import { inSendHours, latestSendSlot, nextSendSlot } from "./hours";
import { extractFrenchMobile } from "./phone";
import { renderOutreachText, type OutreachSettings } from "./settings";

export type PlanInput = {
  step: number; startedAt: Date; lastSentAt: Date | null; phone: string | null;
  lastInboundAt: Date | null; resolvedAt: Date | null;
  /** Current (non-stale) qualification of the conversation, or null. */
  qualification: string | null;
  /** Incoming messages the contact sent after `lastSentAt`, oldest first. */
  replies: { text: string; sentAt: Date }[];
  salon: { status: string; accountStatusLabel: string | null } | null;
  optedOut: boolean; now: Date;
  settings: Pick<OutreachSettings, "step1DelayHours" | "step2DelayDays" | "step3DelayDays" | "sendHourStart" | "sendHourEnd" | "step0Text" | "step1Text" | "askPhoneText">;
  calendarUrl: string;
  /** Display name for the `{nom}` placeholder. */
  name: string;
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
const HOUR_MS = 3600000;
const win = (i: PlanInput) => ({ start: i.settings.sendHourStart, end: i.settings.sendHourEnd });
const step2At = (i: PlanInput) => nextSendSlot(at(i.startedAt, i.settings.step2DelayDays * 24 * HOUR_MS), win(i));
const step3At = (i: PlanInput) => nextSendSlot(at(i.startedAt, i.settings.step3DelayDays * 24 * HOUR_MS), win(i));
function text(i: PlanInput, step: 0 | 1) {
  const s = i.settings;
  const body = renderOutreachText(step === 0 ? s.step0Text : s.step1Text, { link: i.calendarUrl, name: i.name });
  return step === 1 && !i.phone ? `${body}\n${renderOutreachText(s.askPhoneText, { link: i.calendarUrl, name: i.name })}` : body;
}

function stopReason(i: PlanInput): OutreachStopReason | null {
  if (i.salon?.status === "SIGNE" || i.salon?.status === "PAS_INTERESSE") return "SALON_CLOSED";
  if (i.salon?.accountStatusLabel === "demo_booked") return "DEMO_BOOKED";
  if (i.qualification === "FROID") return "COLD";
  if (i.resolvedAt) return "CONVERSATION_DONE";
  return null;
}

function step1(i: PlanInput): OutreachPlan {
  const skip: OutreachPlan = { kind: "skip", toStep: 2, nextRunAt: step2At(i) };
  if (!i.lastInboundAt) return skip;
  const limit = at(i.lastInboundAt, 24 * 3600000 - WINDOW_MARGIN_MS);
  if (i.now >= limit) return skip;
  const base = new Date(Math.max(at(i.lastInboundAt, i.settings.step1DelayHours * HOUR_MS).getTime(), i.now.getTime()));
  const t = inSendHours(base, win(i)) && base < limit ? base : latestSendSlot(limit, i.now, win(i));
  if (!t) return skip;
  return t <= i.now ? { kind: "send_instagram", step: 1, text: text(i, 1) } : { kind: "wait", nextRunAt: t };
}

function whatsappStep(i: PlanInput, step: 2 | 3): OutreachPlan {
  const due = step === 2 ? step2At(i) : step3At(i);
  if (!i.phone) return step === 2 ? { kind: "skip", toStep: 3, nextRunAt: step3At(i) } : due <= i.now ? { kind: "create_task" } : { kind: "wait", nextRunAt: due };
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
    return { kind: "skip", toStep: Math.max(i.step, 2) as 2 | 3, nextRunAt: nextSendSlot(i.now, win(i)), phone, ackAt: last.sentAt };
  }
  if (i.step >= 2 && i.optedOut) return { kind: "stop", reason: "WHATSAPP_OPT_OUT" };

  if (i.step === 0) {
    if (instagramReplyAllowed(i.lastInboundAt, i.now)) return { kind: "send_instagram", step: 0, text: text(i, 0) };
    return i.phone ? { kind: "skip", toStep: 2, nextRunAt: step2At(i) } : { kind: "stop", reason: "SEND_FAILED" };
  }
  if (i.step === 1) return step1(i);
  return whatsappStep(i, i.step === 2 ? 2 : 3);
}
