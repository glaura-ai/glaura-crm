import Link from "next/link";
import { requireInstagramAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { frenchDate } from "@/lib/crm-format";
import { SubmitButton } from "@/components/SubmitButton";
import { OUTREACH_STATUSES, OUTREACH_STEP_LABEL, OUTREACH_STOP_REASONS } from "@/lib/outreach/config";
import { calendarUrlOf, getOutreachSettings, outreachActive, PLACEHOLDERS, renderOutreachText, type OutreachSettings } from "@/lib/outreach/settings";
import { saveAutomationSettings, toggleAutomation } from "@/lib/outreach/settings-actions";
const input = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";
const button = "rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700";
const card = "rounded-xl border border-slate-200 bg-white p-5";
const STATUS_LABEL: Record<string, string> = { ACTIVE: "En cours", STOPPED: "Arrêtées", DONE: "Terminées" };
const STOPS = ["Le contact répond (sauf s’il envoie seulement son numéro : la séquence passe alors sur WhatsApp)", "Le lead est qualifié froid", "Une démo est réservée", "Le contact écrit STOP sur WhatsApp", "Le salon est signé ou pas intéressé", "La conversation est marquée traitée ou la séquence est arrêtée à la main"];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block text-xs text-slate-600">{label}{children}{hint && <span className="mt-1 block text-slate-400">{hint}</span>}</label>;
}
function Preview({ text, link }: { text: string; link: string }) {
  return <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-400">Aperçu</p><p className="mt-1 whitespace-pre-wrap break-words text-slate-800">{renderOutreachText(text, { link, name: "Studio Léa" })}</p></div>;
}
function Step({ n, title, last, children }: { n: number; title: string; last?: boolean; children: React.ReactNode }) {
  return <div className="flex gap-4"><div className="flex flex-col items-center"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-600 text-sm font-semibold text-white">{n}</span>{!last && <span aria-hidden className="mt-1 w-px flex-1 bg-slate-200" />}</div><section className={`${card} mb-4 flex-1 space-y-3`}><h3 className="font-semibold">{title}</h3>{children}</section></div>;
}
const WA_NOTE = "Le texte du modèle est validé dans Meta : seul son nom se règle ici.";

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireInstagramAdmin();
  const sp = await searchParams;
  const s: OutreachSettings = await getOutreachSettings();
  const killed = s.enabled && !outreachActive(s);
  const waReady = !!process.env.META_SYSTEM_USER_TOKEN?.trim() && !!process.env.WHATSAPP_OUTREACH_PHONE_NUMBER_ID?.trim();
  const link = calendarUrlOf(s);
  const [byStatus, activeByStep, byReason, recent] = await Promise.all([
    prisma.outreachSequence.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.outreachSequence.groupBy({ by: ["step"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    prisma.outreachSequence.groupBy({ by: ["stopReason"], where: { status: "STOPPED" }, _count: { _all: true } }),
    prisma.outreachSequence.findMany({ orderBy: { startedAt: "desc" }, take: 20, include: { conversation: { select: { id: true, username: true } } } }),
  ]);
  const count = <T extends { _count: { _all: number } }>(rows: T[], pick: (r: T) => unknown, key: unknown) => rows.find(r => pick(r) === key)?._count._all ?? 0;
  return <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-rose-600">Espace privé</p><h1 className="mt-1 text-3xl font-semibold text-slate-950">Automatisations</h1>
      <p className="mt-2 text-sm">Séquence démo : <strong className={outreachActive(s) ? "text-emerald-700" : "text-amber-700"}>{outreachActive(s) ? "Active" : "Désactivée"}</strong>{killed && <span className="text-rose-700"> · Coupée sur le serveur (OUTREACH_ENABLED=false)</span>}</p>
      <p className="mt-1 text-sm text-slate-500">WhatsApp : {waReady ? "configuré" : "non configuré"}</p></div>
      <form action={toggleAutomation}><SubmitButton className={button}>{s.enabled ? "Couper la séquence" : "Activer la séquence"}</SubmitButton></form></header>
    {sp.error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{sp.error}</p>}
    {sp.saved && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Réglages enregistrés.</p>}

    <section className={card}><h2 className="font-semibold">Statistiques</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div><p className="text-xs font-medium text-slate-500">Séquences</p><ul className="mt-1 space-y-1 text-sm">{OUTREACH_STATUSES.map(st => <li key={st}>{STATUS_LABEL[st]} : {count(byStatus, r => r.status, st)}</li>)}</ul></div>
        <div><p className="text-xs font-medium text-slate-500">En cours, par étape</p><ul className="mt-1 space-y-1 text-sm">{OUTREACH_STEP_LABEL.map((label, i) => <li key={label}>{label} : {count(activeByStep, r => r.step, i)}</li>)}</ul></div>
        <div><p className="text-xs font-medium text-slate-500">Arrêts, par raison</p><ul className="mt-1 space-y-1 text-sm">{Object.entries(OUTREACH_STOP_REASONS).map(([k, label]) => <li key={k} className={k === "DEMO_BOOKED" ? "rounded bg-emerald-50 px-1 font-semibold text-emerald-800" : ""}>{label} : {count(byReason, r => r.stopReason, k)}</li>)}</ul></div>
      </div>
      <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-slate-500"><tr>{["Contact", "Étape", "Statut", "Raison d’arrêt", "Prochain envoi"].map(t => <th key={t} className="py-2 pr-4 font-medium">{t}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
        {recent.map(r => <tr key={r.conversationId}><td className="py-2 pr-4"><Link className="text-rose-700" href={`/instagram?conversation=${r.conversation.id}`}>{r.conversation.username ? `@${r.conversation.username}` : "Contact Instagram"}</Link></td><td className="py-2 pr-4">{OUTREACH_STEP_LABEL[r.step] ?? r.step}</td><td className="py-2 pr-4">{STATUS_LABEL[r.status] ?? r.status}</td><td className="py-2 pr-4">{r.stopReason ? OUTREACH_STOP_REASONS[r.stopReason as keyof typeof OUTREACH_STOP_REASONS] ?? r.stopReason : "—"}</td><td className="py-2 pr-4 text-slate-500">{r.nextRunAt ? frenchDate(r.nextRunAt, true) : "—"}</td></tr>)}
        {!recent.length && <tr><td colSpan={5} className="py-4 text-slate-500">Aucune séquence lancée pour le moment.</td></tr>}
      </tbody></table></div></section>

    <form action={saveAutomationSettings} className="space-y-2">
      <input type="hidden" name="enabled" value={String(s.enabled)} />
      <div><h2 className="font-semibold">Le parcours</h2><p className="mt-1 text-sm text-slate-500">Dans les textes Instagram, {PLACEHOLDERS.link} est remplacé par le lien de réservation et {PLACEHOLDERS.name} par le nom du salon.</p></div>
      <div className="pt-2">
        <Step n={0} title="Message Instagram (immédiat)">
          <Field label="Texte"><textarea name="step0Text" defaultValue={s.step0Text} required maxLength={1000} rows={3} className={`${input} mt-1`} /></Field><Preview text={s.step0Text} link={link} />
        </Step>
        <Step n={1} title="Relance Instagram">
          <Field label="Délai après le dernier message du contact (heures, 1 à 23)" hint="Doit rester dans la fenêtre de réponse Instagram de 24 h."><input name="step1DelayHours" type="number" min={1} max={23} defaultValue={s.step1DelayHours} required className={`${input} mt-1 max-w-32`} /></Field>
          <Field label="Texte"><textarea name="step1Text" defaultValue={s.step1Text} required maxLength={1000} rows={3} className={`${input} mt-1`} /></Field><Preview text={s.step1Text} link={link} />
          <Field label="Ajouté quand on n’a pas de numéro"><textarea name="askPhoneText" defaultValue={s.askPhoneText} required maxLength={1000} rows={2} className={`${input} mt-1`} /></Field><Preview text={s.askPhoneText} link={link} />
        </Step>
        <Step n={2} title="WhatsApp (si numéro)">
          <Field label="Délai depuis le lancement (jours)"><input name="step2DelayDays" type="number" min={1} max={30} defaultValue={s.step2DelayDays} required className={`${input} mt-1 max-w-32`} /></Field>
          <Field label="Nom du modèle WhatsApp" hint={WA_NOTE}><input name="template1" defaultValue={s.template1} required className={`${input} mt-1`} /></Field>
        </Step>
        <Step n={3} title="Dernier WhatsApp" last>
          <Field label="Délai depuis le lancement (jours)"><input name="step3DelayDays" type="number" min={2} max={60} defaultValue={s.step3DelayDays} required className={`${input} mt-1 max-w-32`} /></Field>
          <Field label="Nom du modèle WhatsApp" hint={WA_NOTE}><input name="template2" defaultValue={s.template2} required className={`${input} mt-1`} /></Field>
          <p className="text-xs text-slate-500">Sans numéro : tâche commerciale pour le responsable du salon.</p>
        </Step>
      </div>
      <section className={`${card} space-y-3`}><h2 className="font-semibold">Général</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoStart" defaultChecked={s.autoStart} />Lancer automatiquement pour les leads chauds et tièdes</label>
        <div className="flex flex-wrap gap-4"><Field label="Envoi à partir de (h, heure de Paris)"><input name="sendHourStart" type="number" min={0} max={23} defaultValue={s.sendHourStart} required className={`${input} mt-1 w-32`} /></Field><Field label="Jusqu’à (h)"><input name="sendHourEnd" type="number" min={1} max={24} defaultValue={s.sendHourEnd} required className={`${input} mt-1 w-32`} /></Field><Field label="Langue des modèles"><input name="templateLang" defaultValue={s.templateLang} required className={`${input} mt-1 w-32`} /></Field></div>
        <Field label="Lien de réservation de la démo" hint="Laissez vide pour utiliser le lien par défaut."><input name="calendarUrl" type="url" defaultValue={s.calendarUrl ?? ""} placeholder={calendarUrlOf({ calendarUrl: null })} className={`${input} mt-1`} /></Field>
      </section>
      <SubmitButton className={button} pendingLabel="Enregistrement…">Enregistrer les réglages</SubmitButton>
    </form>

    <section className={card}><h2 className="font-semibold">Conditions d’arrêt</h2><p className="mt-1 text-sm text-slate-500">La séquence s’arrête dès que :</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{STOPS.map(t => <li key={t}>{t}</li>)}</ul></section>
  </div>;
}
