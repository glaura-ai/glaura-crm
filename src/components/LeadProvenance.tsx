import { leadProvenance, type ProvenanceLead } from "@/lib/lead-provenance";

export function LeadProvenance({ lead }: { lead: ProvenanceLead }) {
  const { label, detail, url } = leadProvenance(lead);
  return (
    <span className="inline-flex flex-col gap-1 text-sm">
      {url ? <a href={url} target="_blank" rel="noreferrer" className="relative z-10 font-medium text-violet-700 hover:underline" aria-label={`Voir la source : ${label}`}>{label} ↗</a> : <span className="font-medium text-slate-700">{label}</span>}
      {detail && <span className="text-xs text-slate-500">{detail}</span>}
    </span>
  );
}
