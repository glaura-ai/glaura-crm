import Link from "next/link";
import { requireInstagramAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { frenchDate } from "@/lib/crm-format";
import { OutreachFlow } from "@/components/automations/OutreachFlow";
import { OUTREACH_STATUSES, OUTREACH_STEP_COUNT, OUTREACH_STEP_LABEL, OUTREACH_STOP_REASONS } from "@/lib/outreach/config";
import { calendarUrlOf, getOutreachSettings, outreachActive, type OutreachSettings } from "@/lib/outreach/settings";
import { saveAutomationSettings, toggleAutomation } from "@/lib/outreach/settings-actions";
import { fetchTemplateStatuses } from "@/lib/outreach/templates";
const card = "rounded-xl border border-slate-200 bg-white p-5";
const STATUS_LABEL: Record<string, string> = { ACTIVE: "En cours", STOPPED: "Arrêtées", DONE: "Terminées" };
const STOPS = ["Le contact répond (sauf s’il envoie seulement son numéro : la séquence passe alors sur WhatsApp)", "Le lead est qualifié froid", "Une démo est réservée", "Le contact écrit STOP sur WhatsApp", "Le salon est signé ou pas intéressé", "La conversation est marquée traitée ou la séquence est arrêtée à la main"];

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireInstagramAdmin();
  const sp = await searchParams;
  const s: OutreachSettings = await getOutreachSettings();
  const killed = s.enabled && !outreachActive(s);
  const waReady = !!process.env.META_SYSTEM_USER_TOKEN?.trim() && !!process.env.WHATSAPP_OUTREACH_PHONE_NUMBER_ID?.trim();
  const [byStatus, activeByStep, byReason, recent, templateStatuses] = await Promise.all([
    prisma.outreachSequence.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.outreachSequence.groupBy({ by: ["step"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    prisma.outreachSequence.groupBy({ by: ["stopReason"], where: { status: "STOPPED" }, _count: { _all: true } }),
    prisma.outreachSequence.findMany({ orderBy: { startedAt: "desc" }, take: 20, include: { conversation: { select: { id: true, username: true } } } }),
    fetchTemplateStatuses([s.template1, s.template2]),
  ]);
  const count = <T extends { _count: { _all: number } }>(rows: T[], pick: (r: T) => unknown, key: unknown) => rows.find(r => pick(r) === key)?._count._all ?? 0;
  const initial = { autoStart: s.autoStart, step0Text: s.step0Text, step1Text: s.step1Text, askPhoneText: s.askPhoneText, step1DelayHours: String(s.step1DelayHours), step2DelayDays: String(s.step2DelayDays), step3DelayDays: String(s.step3DelayDays), sendHourStart: String(s.sendHourStart), sendHourEnd: String(s.sendHourEnd), template1: s.template1, template2: s.template2, templateLang: s.templateLang, calendarUrl: s.calendarUrl ?? "" };
  const stats = {
    statuses: OUTREACH_STATUSES.map(st => ({ key: st, label: STATUS_LABEL[st], count: count(byStatus, r => r.status, st) })),
    reasons: Object.entries(OUTREACH_STOP_REASONS).map(([k, label]) => ({ key: k, label, count: count(byReason, r => r.stopReason, k) })),
  };
  return <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <header><p className="text-sm font-medium text-rose-600">Espace privé</p><h1 className="mt-1 text-3xl font-semibold text-slate-950">Automatisations</h1></header>
    {sp.error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{sp.error}</p>}
    {sp.saved && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Réglages enregistrés.</p>}

    <OutreachFlow initial={initial} enabled={s.enabled} active={outreachActive(s)} killed={killed} waReady={waReady} defaultLink={calendarUrlOf({ calendarUrl: null })}
      stepCounts={Array.from({ length: OUTREACH_STEP_COUNT }, (_, i) => count(activeByStep, r => r.step, i))} stats={stats} stops={STOPS} templateStatuses={templateStatuses}
      saveAction={saveAutomationSettings} toggleAction={toggleAutomation} />

    <section className={card}><h2 className="font-semibold">20 dernières séquences</h2>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-slate-500"><tr>{["Contact", "Étape", "Statut", "Raison d’arrêt", "Prochain envoi"].map(t => <th key={t} className="py-2 pr-4 font-medium">{t}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
        {recent.map(r => <tr key={r.conversationId}><td className="py-2 pr-4"><Link className="text-rose-700" href={`/instagram?conversation=${r.conversation.id}`}>{r.conversation.username ? `@${r.conversation.username}` : "Contact Instagram"}</Link></td><td className="py-2 pr-4">{OUTREACH_STEP_LABEL[r.step] ?? r.step}</td><td className="py-2 pr-4">{STATUS_LABEL[r.status] ?? r.status}</td><td className="py-2 pr-4">{r.stopReason ? OUTREACH_STOP_REASONS[r.stopReason as keyof typeof OUTREACH_STOP_REASONS] ?? r.stopReason : "—"}</td><td className="py-2 pr-4 text-slate-500">{r.nextRunAt ? frenchDate(r.nextRunAt, true) : "—"}</td></tr>)}
        {!recent.length && <tr><td colSpan={5} className="py-4 text-slate-500">Aucune séquence lancée pour le moment.</td></tr>}
      </tbody></table></div></section>
  </div>;
}
