import type { LeadSource, ProspectSource } from "@/generated/prisma/enums";
import { PROSPECT_SOURCE_LABEL } from "@/lib/labels";

export type ProvenanceLead = {
  source: LeadSource;
  sourceLabel?: string | null;
  prospect?: { source: ProspectSource; sourceUrl: string | null } | null;
};

const SOURCE_LABEL: Record<LeadSource, string> = {
  MANUAL: "Saisie manuelle", AIRTABLE: "Import Airtable", IMPORT: "Import", SCRAPE: "Prospection",
};

export function leadProvenance(lead: ProvenanceLead) {
  const recordedLabel = lead.sourceLabel?.trim() || null;
  const label = lead.prospect ? PROSPECT_SOURCE_LABEL[lead.prospect.source] : recordedLabel ?? SOURCE_LABEL[lead.source];
  const details = [
    recordedLabel && recordedLabel !== label ? recordedLabel : null,
    (lead.source === "AIRTABLE" || lead.source === "IMPORT") && label !== SOURCE_LABEL[lead.source] ? SOURCE_LABEL[lead.source] : null,
  ].filter(Boolean);
  let url: string | null = null;
  try {
    const parsed = new URL(lead.prospect?.sourceUrl ?? "");
    if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href;
  } catch { /* Historical leads may have no source URL. */ }
  return { label, detail: details.join(" · ") || null, url };
}
