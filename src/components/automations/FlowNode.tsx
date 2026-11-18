import type { ReactNode } from "react";
import { BoltIcon, BranchIcon, ClockIcon, InstagramIcon, StopIcon, TaskIcon, WhatsappIcon } from "./icons";

export type NodeTone = "trigger" | "instagram" | "delay" | "whatsapp" | "condition" | "task" | "stop";
const TONES: Record<NodeTone, { tile: string; kind: string; label: string; icon: ReactNode }> = {
  trigger: { tile: "bg-violet-50 text-violet-700", kind: "text-violet-700", label: "Déclencheur", icon: <BoltIcon /> },
  instagram: { tile: "bg-rose-50 text-rose-600", kind: "text-rose-600", label: "Instagram", icon: <InstagramIcon /> },
  delay: { tile: "bg-amber-50 text-amber-700", kind: "text-amber-700", label: "Délai", icon: <ClockIcon /> },
  whatsapp: { tile: "bg-emerald-50 text-emerald-700", kind: "text-emerald-700", label: "WhatsApp", icon: <WhatsappIcon /> },
  condition: { tile: "bg-sky-50 text-sky-700", kind: "text-sky-700", label: "Condition", icon: <BranchIcon /> },
  task: { tile: "bg-slate-100 text-slate-700", kind: "text-slate-600", label: "Tâche", icon: <TaskIcon /> },
  stop: { tile: "bg-slate-100 text-slate-700", kind: "text-slate-600", label: "Arrêt", icon: <StopIcon /> },
};

export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${className}`}>{children}</span>;
}

export function NodeHeader({ tone }: { tone: NodeTone }) {
  const t = TONES[tone];
  return <span className="flex items-center gap-2"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.tile}`}>{t.icon}</span><span className={`text-[11px] font-semibold uppercase tracking-wider ${t.kind}`}>{t.label}</span></span>;
}

export function FlowNode({ tone, title, subtitle, count, pill, selected, onSelect }: {
  tone: NodeTone; title: string; subtitle?: string; count?: number; pill?: ReactNode; selected: boolean; onSelect: () => void;
}) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} data-node-tone={tone}
      className={`w-72 max-w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 ${selected ? "border-rose-500 ring-2 ring-rose-200" : "border-slate-200 hover:border-rose-300"}`}>
      <span className="flex items-center justify-between gap-2"><NodeHeader tone={tone} />{count !== undefined && <span title="Séquences en cours à cette étape" className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${count > 0 ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-500"}`}>{count} en cours</span>}</span>
      <span className="mt-2 block text-sm font-semibold text-slate-900">{title}</span>
      {subtitle && <span className="mt-0.5 line-clamp-2 block break-words text-xs text-slate-500">{subtitle}</span>}
      {pill && <span className="mt-2 block">{pill}</span>}
    </button>
  );
}

export const Connector = () => <span aria-hidden className="block h-5 w-px bg-slate-300" />;
