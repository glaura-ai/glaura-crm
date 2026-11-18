import type { TemplateStatus } from "@/lib/outreach/templates";

export type FlowNodeId = "trigger" | "ig0" | "delay1" | "ig1" | "cond" | "delay2" | "wa1" | "delay3yes" | "wa2" | "delay3no" | "task";
export type FlowValues = {
  autoStart: boolean; step0Text: string; step1Text: string; askPhoneText: string;
  step1DelayHours: string; step2DelayDays: string; step3DelayDays: string;
  sendHourStart: string; sendHourEnd: string; template1: string; template2: string; templateLang: string; calendarUrl: string;
};
export type FlowAction = (formData: FormData) => void | Promise<void>;
export type FlowStats = {
  statuses: { key: string; label: string; count: number }[];
  reasons: { key: string; label: string; count: number }[];
};
export type TemplateStatuses = Record<string, TemplateStatus> | null;

/** Sequences ACTIVE at a given step (0..3) are shown on the node(s) of that step. */
export const NODE_STEP: Partial<Record<FlowNodeId, number>> = { ig0: 0, ig1: 1, wa1: 2, wa2: 3, task: 3 };

/** Client-side twin of renderOutreachText (the server module pulls in prisma). */
export function renderPreviewText(template: string, link: string, name = "Studio Léa") {
  return template.replaceAll("{lien_demo}", link).replaceAll("{nom}", name);
}

export const STATUS_PILL: Record<TemplateStatus, { label: string; cls: string }> = {
  APPROVED: { label: "Approuvé", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  PENDING: { label: "En attente", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  REJECTED: { label: "Refusé", cls: "bg-rose-50 text-rose-800 ring-rose-200" },
  PAUSED: { label: "En pause", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  MISSING: { label: "Introuvable", cls: "bg-rose-50 text-rose-800 ring-rose-200" },
};
