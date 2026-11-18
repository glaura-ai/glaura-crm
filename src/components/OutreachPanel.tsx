import type { ReactNode } from "react";
import { SubmitButton } from "./SubmitButton";
import { frenchDate } from "@/lib/crm-format";
import { markDemoBooked, startOutreach, stopOutreach } from "@/lib/outreach/actions";
import { OUTREACH_STEP_LABEL, OUTREACH_STOP_REASONS, type OutreachStopReason } from "@/lib/outreach/config";

type Sequence = { status: string; step: number; nextRunAt: Date | null; phone: string | null; stopReason: string | null; lastError: string | null };
const button = "rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700";

export function OutreachPanel({ enabled, autoStart, sequence, qualification, done, hidden }: { enabled: boolean; autoStart: boolean; sequence: Sequence | null; qualification: string | null; done: boolean; hidden: ReactNode }) {
  const demoBooked = sequence?.stopReason === "DEMO_BOOKED";
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">Séquence démo</h2>
    {!enabled && <p className="mt-2 text-xs text-amber-700">La séquence automatique est désactivée.</p>}
    {!sequence && <><p className="mt-2 text-xs text-slate-500">Message Instagram, relance Instagram, WhatsApp si numéro, dernier WhatsApp. Elle s’arrête dès que le contact répond ou réserve.{autoStart && " Démarrage automatique pour les leads chauds et tièdes."}</p>
      {enabled && qualification !== "FROID" && !done && <form action={startOutreach} className="mt-3">{hidden}<SubmitButton className={button} pendingLabel="Lancement…">Lancer la séquence</SubmitButton></form>}</>}
    {sequence?.status === "ACTIVE" && <><p className="mt-2 text-sm">En cours · prochaine étape : {OUTREACH_STEP_LABEL[sequence.step] ?? sequence.step}</p>
      {sequence.nextRunAt && <p className="mt-1 text-xs text-slate-500">Envoi prévu : {frenchDate(sequence.nextRunAt, true)}</p>}
      {sequence.phone && <p className="mt-1 text-xs text-slate-500">WhatsApp : {sequence.phone}</p>}
      {sequence.lastError && <p className="mt-1 text-xs text-rose-700">{sequence.lastError}</p>}
      <form action={stopOutreach} className="mt-3">{hidden}<SubmitButton className="text-sm text-rose-700">Arrêter</SubmitButton></form></>}
    {sequence && sequence.status !== "ACTIVE" && <p className="mt-2 text-sm">{sequence.status === "DONE" ? "Terminée" : "Arrêtée"}{sequence.stopReason && ` · ${OUTREACH_STOP_REASONS[sequence.stopReason as OutreachStopReason] ?? sequence.stopReason}`}</p>}
    {!demoBooked && <form action={markDemoBooked} className="mt-3">{hidden}<SubmitButton className="text-sm text-rose-700">Démo réservée</SubmitButton></form>}
  </section>;
}
