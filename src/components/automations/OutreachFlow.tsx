"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { Connector, FlowNode, Pill } from "./FlowNode";
import { StopIcon } from "./icons";
import { NodePanel } from "./NodePanel";
import { NODE_STEP, STATUS_PILL, type FlowAction, type FlowNodeId, type FlowStats, type FlowValues, type TemplateStatuses } from "./types";

type Props = {
  initial: FlowValues;
  enabled: boolean; active: boolean; killed: boolean; waReady: boolean;
  /** Default booking link, used when the calendar field is empty. */
  defaultLink: string;
  /** ACTIVE sequences waiting at each step (index 0..3). */
  stepCounts: number[];
  stats: FlowStats;
  stops: string[];
  templateStatuses: TemplateStatuses;
  saveAction: FlowAction;
  toggleAction: FlowAction;
  initialSelected?: FlowNodeId | null;
};

const button = "rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700";
const TOGGLE_FORM = "toggle-automation";

export function OutreachFlow({ initial, enabled, active, killed, waReady, defaultLink, stepCounts, stats, stops, templateStatuses, saveAction, toggleAction, initialSelected = null }: Props) {
  const [v, setV] = useState<FlowValues>(initial);
  const [selected, setSelected] = useState<FlowNodeId | null>(initialSelected);
  const set = <K extends keyof FlowValues>(key: K, value: FlowValues[K]) => setV(cur => ({ ...cur, [key]: value }));
  // Messages carry the tracked /demo/<token> link, which redirects to the salesperson's calendar.
  const link = "https://crm.glaura.ai/demo/7f3c…";
  const node = (id: FlowNodeId, tone: Parameters<typeof FlowNode>[0]["tone"], title: string, subtitle?: string, pill?: React.ReactNode) => {
    const step = NODE_STEP[id];
    return <FlowNode tone={tone} title={title} subtitle={subtitle} pill={pill} count={step === undefined ? undefined : stepCounts[step] ?? 0} selected={selected === id} onSelect={() => setSelected(cur => (cur === id ? null : id))} />;
  };
  const tpl = (name: string) => { const s = templateStatuses?.[name.trim()]; return s ? <Pill className={STATUS_PILL[s].cls}>{STATUS_PILL[s].label}</Pill> : undefined; };
  const days = (n: string) => `Jour ${n}`;

  return <div className="space-y-4">
    <form id={TOGGLE_FORM} action={toggleAction} />
    <form action={saveAction} className="space-y-4">
      <input type="hidden" name="enabled" value={String(enabled)} />
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-950">Séquence démo</h2>
          <Pill className={active ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}>{active ? "Active" : "Désactivée"}</Pill>
          {killed && <span className="text-xs text-rose-700">Coupée sur le serveur (OUTREACH_ENABLED=false)</span>}
          <Pill className={waReady ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}>{waReady ? "WhatsApp configuré" : "WhatsApp non configuré"}</Pill>
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" form={TOGGLE_FORM} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">{enabled ? "Couper la séquence" : "Activer la séquence"}</button>
          <SubmitButton className={button} pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <div className="overflow-x-clip rounded-2xl border border-slate-200 bg-slate-50 bg-[radial-gradient(circle,#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] px-4 py-8">
          <div className="flex flex-col items-center">
            {node("trigger", "trigger", "Message Instagram entrant", v.autoStart ? "Automatique : leads chauds et tièdes" : "Lancement manuel")}
            <Connector />
            {node("ig0", "instagram", "Message avec le lien de démo", v.step0Text)}
            <Connector />
            {node("delay1", "delay", `Attendre ${v.step1DelayHours} h après le dernier message`, "Fenêtre Instagram : 24 h")}
            <Connector />
            {node("ig1", "instagram", "Relance + demande du numéro", v.step1Text)}
            <Connector />
            {node("cond", "condition", "Numéro WhatsApp donné ?")}
            <Connector />
            <div className="w-full max-w-2xl">
              <div aria-hidden className="mx-auto hidden h-px w-1/2 bg-slate-300 md:block" />
              <div className="grid gap-8 md:grid-cols-2 md:gap-4">
                <Branch label="Oui">
                  {node("delay2", "delay", days(v.step2DelayDays))}<Connector />
                  {node("wa1", "whatsapp", v.template1, "Premier WhatsApp", tpl(v.template1))}<Connector />
                  {node("delay3yes", "delay", days(v.step3DelayDays))}<Connector />
                  {node("wa2", "whatsapp", v.template2, "Dernier WhatsApp", tpl(v.template2))}
                </Branch>
                <Branch label="Non">
                  {node("delay3no", "delay", days(v.step3DelayDays))}<Connector />
                  {node("task", "task", "Tâche commerciale pour le responsable du salon")}
                </Branch>
              </div>
            </div>
          </div>
          <section aria-label="Conditions d’arrêt" className="mx-auto mt-8 max-w-md rounded-2xl border border-dashed border-slate-300 bg-white p-4">
            <span className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><StopIcon /></span><span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Arrêt</span></span>
            <p className="mt-2 text-sm font-semibold text-slate-900">La séquence s’arrête dès que :</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-600">{stops.map(t => <li key={t}>{t}</li>)}</ul>
          </section>
        </div>
        <NodePanel selected={selected} onClose={() => setSelected(null)} goTo={setSelected} v={v} set={set} link={link} defaultLink={defaultLink} statuses={templateStatuses} stats={stats} />
      </div>
    </form>
  </div>;
}

function Branch({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col items-center"><Connector /><span className="my-1 rounded-full bg-white px-3 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300">{label}</span><Connector />{children}</div>;
}
