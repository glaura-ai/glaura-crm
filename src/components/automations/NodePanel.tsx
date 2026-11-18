import type { ReactNode } from "react";
import { NodeHeader, Pill, type NodeTone } from "./FlowNode";
import { STATUS_PILL, renderPreviewText, type FlowNodeId, type FlowStats, type FlowValues, type TemplateStatuses } from "./types";

const input = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100";
type Set = <K extends keyof FlowValues>(key: K, value: FlowValues[K]) => void;
type FieldsProps = { v: FlowValues; set: Set; link: string; statuses: TemplateStatuses; defaultLink: string; goTo: (id: FlowNodeId) => void };

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block text-xs font-medium text-slate-600">{label}{children}{hint && <span className="mt-1 block font-normal text-slate-400">{hint}</span>}</label>;
}
function Preview({ text, link }: { text: string; link: string }) {
  return <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-400">Aperçu</p><p data-testid="preview" className="mt-1 whitespace-pre-wrap break-words text-slate-800">{renderPreviewText(text, link)}</p></div>;
}
function Num({ name, v, set, min, max, label, hint }: { name: "step1DelayHours" | "step2DelayDays" | "step3DelayDays" | "sendHourStart" | "sendHourEnd"; v: FlowValues; set: Set; min: number; max: number; label: string; hint?: string }) {
  return <Field label={label} hint={hint}><input name={name} type="number" min={min} max={max} required value={v[name]} onChange={e => set(name, e.target.value)} className={`${input} max-w-32`} /></Field>;
}
function Text({ name, v, set, label, rows, hint, link }: { name: "step0Text" | "step1Text" | "askPhoneText"; v: FlowValues; set: Set; label: string; rows: number; hint?: string; link: string }) {
  return <div><Field label={label} hint={hint}><textarea name={name} required maxLength={1000} rows={rows} value={v[name]} onChange={e => set(name, e.target.value)} className={input} /></Field><Preview text={v[name]} link={link} /></div>;
}
function TemplateField({ name, v, set, statuses }: { name: "template1" | "template2"; v: FlowValues; set: Set; statuses: TemplateStatuses }) {
  const status = statuses?.[v[name].trim()];
  return <div><Field label="Nom du modèle WhatsApp" hint="Le texte du modèle est validé dans Meta : seul son nom se règle ici."><input name={name} required value={v[name]} onChange={e => set(name, e.target.value)} className={input} /></Field>
    <p className="mt-2 text-xs text-slate-500">Statut Meta : {status ? <Pill className={STATUS_PILL[status].cls}>{STATUS_PILL[status].label}</Pill> : <span className="text-slate-400">indisponible</span>}</p></div>;
}
const Note = ({ children }: { children: ReactNode }) => <p className="text-sm text-slate-600">{children}</p>;

const PANELS: Record<FlowNodeId, { tone: NodeTone; title: string; body: (p: FieldsProps) => ReactNode }> = {
  trigger: { tone: "trigger", title: "Message Instagram entrant", body: ({ v, set, defaultLink }) => <>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoStart" checked={v.autoStart} onChange={e => set("autoStart", e.target.checked)} />Lancer automatiquement pour les leads chauds et tièdes</label>
    <div className="flex flex-wrap gap-4"><Num name="sendHourStart" v={v} set={set} min={0} max={23} label="Envoi à partir de (h, Paris)" /><Num name="sendHourEnd" v={v} set={set} min={1} max={24} label="Jusqu’à (h)" /></div>
    <Field label="Langue des modèles"><input name="templateLang" required value={v.templateLang} onChange={e => set("templateLang", e.target.value)} className={`${input} max-w-32`} /></Field>
    <Field label="Lien de réservation par défaut" hint="Utilisé quand le commercial du salon n’a pas renseigné son lien (Équipe et accès). Les messages contiennent un lien suivi crm.glaura.ai/demo/… qui redirige vers le bon agenda et compte les clics."><input name="calendarUrl" type="url" value={v.calendarUrl} placeholder={defaultLink} onChange={e => set("calendarUrl", e.target.value)} className={input} /></Field></> },
  ig0: { tone: "instagram", title: "Message avec le lien de démo", body: ({ v, set, link }) => <>
    <Note>Envoyé immédiatement au lancement. {"{lien_demo}"} est remplacé par le lien de réservation et {"{nom}"} par le nom du salon.</Note>
    <Text name="step0Text" v={v} set={set} link={link} label="Texte" rows={4} /></> },
  delay1: { tone: "delay", title: "Attendre avant la relance", body: ({ v, set }) => <Num name="step1DelayHours" v={v} set={set} min={1} max={23} label="Délai après le dernier message du contact (heures, 1 à 23)" hint="Doit rester dans la fenêtre de réponse Instagram de 24 h." /> },
  ig1: { tone: "instagram", title: "Relance + demande du numéro", body: ({ v, set, link }) => <>
    <Text name="step1Text" v={v} set={set} link={link} label="Texte de la relance" rows={3} />
    <Text name="askPhoneText" v={v} set={set} link={link} label="Ajouté quand on n’a pas de numéro" rows={2} /></> },
  cond: { tone: "condition", title: "Numéro WhatsApp donné ?", body: () => <Note>Si le contact a donné un numéro valide, la séquence continue sur WhatsApp. Sinon, un responsable du salon reçoit une tâche commerciale. Cette étape n’a aucun réglage.</Note> },
  delay2: { tone: "delay", title: "Délai avant le 1er WhatsApp", body: ({ v, set }) => <Num name="step2DelayDays" v={v} set={set} min={1} max={30} label="Délai depuis le lancement (jours)" /> },
  wa1: { tone: "whatsapp", title: "Premier WhatsApp", body: ({ v, set, statuses }) => <TemplateField name="template1" v={v} set={set} statuses={statuses} /> },
  delay3yes: { tone: "delay", title: "Délai avant le dernier WhatsApp", body: ({ v, set }) => <Num name="step3DelayDays" v={v} set={set} min={2} max={60} label="Délai depuis le lancement (jours)" hint="Ce délai s’applique aussi à la branche « Non »." /> },
  wa2: { tone: "whatsapp", title: "Dernier WhatsApp", body: ({ v, set, statuses }) => <TemplateField name="template2" v={v} set={set} statuses={statuses} /> },
  delay3no: { tone: "delay", title: "Délai avant la tâche", body: ({ goTo }) => <><Note>Même délai que le dernier WhatsApp de la branche « Oui ».</Note><button type="button" onClick={() => goTo("delay3yes")} className="text-sm font-medium text-rose-700 hover:underline">Modifier ce délai</button></> },
  task: { tone: "task", title: "Tâche commerciale", body: () => <Note>Une tâche est créée pour le responsable du salon afin de relancer le contact à la main. Cette étape n’a aucun réglage.</Note> },
};

export function NodePanel({ selected, onClose, stats, ...p }: FieldsProps & { selected: FlowNodeId | null; onClose: () => void; stats: FlowStats }) {
  return <aside aria-label="Réglages de l’étape" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-4">
    <div hidden={selected !== null} data-panel="stats" className="space-y-5">
      <div><h2 className="font-semibold text-slate-900">Statistiques</h2><p className="mt-1 text-xs text-slate-500">Cliquez sur une étape pour régler ses paramètres.</p></div>
      <div><p className="text-xs font-medium text-slate-500">Séquences</p><ul className="mt-1 space-y-1 text-sm">{stats.statuses.map(s => <li key={s.key}>{s.label} : {s.count}</li>)}</ul></div>
      <div><p className="text-xs font-medium text-slate-500">Arrêts, par raison</p><ul className="mt-1 space-y-1 text-sm">{stats.reasons.map(r => <li key={r.key} className={r.key === "DEMO_BOOKED" ? "rounded bg-emerald-50 px-1 font-semibold text-emerald-800" : ""}>{r.label} : {r.count}</li>)}</ul></div>
    </div>
    {(Object.keys(PANELS) as FlowNodeId[]).map(id => { const def = PANELS[id]; return (
      <section key={id} hidden={selected !== id} data-panel={id} className="space-y-4">
        <div className="flex items-start justify-between gap-2"><div><NodeHeader tone={def.tone} /><h2 className="mt-2 font-semibold text-slate-900">{def.title}</h2></div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">Fermer</button></div>
        {def.body(p)}
      </section>); })}
  </aside>;
}
