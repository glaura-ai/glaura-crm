import type { Metier, ProspectSource } from "@/generated/prisma/enums";

// One directory page (or paginated page set) to crawl.
export type SweepTarget = {
  source: ProspectSource;
  url: string;
  metiers: Metier[]; // métier(s) implied by the directory category swept
  label: string; // human-readable, for logs
  zoneHint?: string; // zone slug when a listing carries no usable postal code
};
