import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/labels";
import { frenchDate } from "@/lib/crm-format";
import { leadTrackingInclude, nextLeadAction } from "@/lib/instagram-inbox/tracking";

type Lead = Prisma.SalonGetPayload<{ include: typeof leadTrackingInclude }>;
export function InstagramLeadSummary({ salon, compact = false }: { salon: Lead | null; compact?: boolean }) {
  if (!salon) return <p className="mt-2 text-xs text-amber-800">Sans lead · Liez un salon pour suivre sa progression.</p>;
  const next = nextLeadAction(salon);
  return <div className={`mt-3 space-y-2 ${compact ? "text-xs" : "text-sm"}`}>
    {compact ? <p className="truncate font-medium text-slate-800">{salon.name}</p> : <Link href={`/salons/${salon.id}`} className="block font-medium text-rose-700">{salon.name} →</Link>}
    <p><span className={`inline-block rounded-full px-2 py-1 text-xs ${STATUS_STYLE[salon.status]}`}>{STATUS_LABEL[salon.status]}</span></p>
    <p className="text-slate-600">Responsable : {salon.assignedTo ? `${salon.assignedTo.name ?? salon.assignedTo.email}${salon.assignedTo.active ? "" : " (inactif)"}` : "Non attribué"}</p>
    {next ? <div className={next.overdue ? "text-rose-700" : "text-slate-600"}>
      <p className="font-medium">{next.overdue ? "En retard · " : "Prochaine action · "}{next.title}</p>
      <p>{frenchDate(next.dueAt, true)}</p>
    </div> : <p className="text-amber-800">Aucune prochaine action planifiée</p>}
    {!compact && <Link href={`/taches?salon=${salon.id}`} className="block text-rose-700">Voir les tâches du salon →</Link>}
  </div>;
}
