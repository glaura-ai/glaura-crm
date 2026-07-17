import type { ProspectSource } from "@/generated/prisma/enums";
import { booksyTargets } from "@/lib/prospection/sources/booksy";
import { freshaTargets } from "@/lib/prospection/sources/fresha";
import { planityTargets } from "@/lib/prospection/sources/planity";
import { treatwellTargets } from "@/lib/prospection/sources/treatwell";
import type { SweepTarget } from "@/lib/prospection/types";
import type { Zone } from "@/lib/prospection/zones";

export const ALL_SOURCES: ProspectSource[] = ["TREATWELL", "PLANITY", "BOOKSY", "FRESHA"];

const BUILDERS: Record<ProspectSource, (zones: Zone[]) => SweepTarget[]> = {
  TREATWELL: treatwellTargets,
  PLANITY: planityTargets,
  BOOKSY: booksyTargets,
  FRESHA: freshaTargets,
};

export function buildTargets(sources: ProspectSource[], zones: Zone[]): SweepTarget[] {
  return sources.flatMap((source) => BUILDERS[source](zones));
}
