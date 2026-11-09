import type { ReactNode } from "react";
import type { InstagramConversation, InstagramMessage } from "@/generated/prisma/client";
import { currentQualification, qualificationHash, temperatureSchema, TEMPERATURES, QUALIFICATION_LABEL, QUALIFICATION_STYLE } from "@/lib/instagram-inbox/qualification";
import { qualifyInstagramLead, overrideInstagramQualification } from "@/lib/instagram-inbox/actions";
import { frenchDate } from "@/lib/crm-format";
import { SubmitButton } from "./SubmitButton";

export function QualificationBadge({ value, pending }: { value: string | null; pending: boolean }) {
  const parsed = temperatureSchema.safeParse(value);
  return <span className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${!pending && parsed.success ? QUALIFICATION_STYLE[parsed.data] : "bg-slate-100 text-slate-500"}`}>{pending ? "À qualifier · analyse en cours" : parsed.success ? QUALIFICATION_LABEL[parsed.data] : "À qualifier"}</span>;
}

export function InstagramLeadQualifier({ conversation, latest, hidden }: { conversation: InstagramConversation; latest: InstagramMessage | null; hidden: ReactNode }) {
  const current = currentQualification(conversation, latest);
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="mb-3 font-semibold">Qualification du lead</h2>
    <QualificationBadge value={current ? conversation.qualification : null} pending={conversation.qualificationPending} />
    {!latest ? <p className="mt-3 text-xs text-slate-500">Un message entrant est nécessaire pour qualifier ce lead.</p> : <>
      <p className="mt-3 text-xs text-slate-500">Basée sur le dernier message reçu le {frenchDate(latest.sentAt, true)}. Les nouveaux messages sont qualifiés automatiquement.</p>
      {current && <><p className="mt-3 text-sm text-slate-700">{conversation.qualificationReason}</p><p className="mt-2 text-xs text-slate-500">{conversation.qualificationSource === "MANUAL" ? "Qualification manuelle" : `${conversation.qualificationSource === "AI" ? "Analyse IA" : "Qualification automatique"} · confiance ${conversation.qualificationConfidence === "HIGH" ? "élevée" : conversation.qualificationConfidence === "MEDIUM" ? "moyenne" : "faible"}`}</p><div className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-xs font-medium text-slate-500">Prochaine action proposée</p><p className="mt-1 text-sm text-slate-800">{conversation.qualificationAction}</p></div></>}
      {conversation.qualificationError && <p className="mt-3 text-xs text-amber-800">{conversation.qualificationError}</p>}
      {!conversation.qualificationPending && <form action={qualifyInstagramLead} className="mt-3">{hidden}<input type="hidden" name="sourceMessageId" value={latest.id} /><input type="hidden" name="sourceMessageHash" value={qualificationHash(latest.text)} /><SubmitButton className="text-sm font-medium text-rose-700" pendingLabel="Mise en file…">{current ? "Réévaluer le dernier message" : "Qualifier le dernier message"}</SubmitButton></form>}
      <details className="mt-4"><summary className="cursor-pointer text-xs text-slate-600">Choisir une qualification manuelle</summary><form action={overrideInstagramQualification} className="mt-3 space-y-3">{hidden}<input type="hidden" name="sourceMessageId" value={latest.id} /><input type="hidden" name="sourceMessageHash" value={qualificationHash(latest.text)} /><select name="temperature" aria-label="Qualification manuelle du lead" defaultValue={current ? conversation.qualification! : "A_RECONTACTER"} className="w-full rounded-lg border border-slate-200 p-2 text-sm">{TEMPERATURES.map(t => <option key={t} value={t}>{QUALIFICATION_LABEL[t]}</option>)}</select><SubmitButton className="text-sm font-medium text-rose-700">Enregistrer la qualification</SubmitButton></form></details>
      <p className="mt-3 text-xs text-slate-400">Le statut commercial reste indépendant. Seule la température du lead est reportée sur la fiche salon ; les messages et l’analyse restent privés.</p>
    </>}
  </section>;
}
