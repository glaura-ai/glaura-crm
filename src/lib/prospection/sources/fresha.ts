import type { Metier } from "@/generated/prisma/enums";
import type { SweepTarget } from "@/lib/prospection/types";
import type { Zone } from "@/lib/prospection/zones";

// Fresha landing pages are server-rendered with a JSON-LD @graph of business
// nodes (~130 per page, ratingCount + full postal address, no pagination).
// URL shape: /lp/en/bt/{business-type}/in/fr-paris-paris
// Their "Paris" area already includes petite couronne towns (postal codes on
// each node route listings to the right zone), so one page set covers all zones.

const BASE = "https://www.fresha.com";

const BUSINESS_TYPES: ReadonlyArray<{ slug: string; metiers: Metier[] }> = [
  { slug: "hair-salons", metiers: ["COIFFURE"] },
  { slug: "barbershops", metiers: ["BARBIER"] },
  { slug: "nail-salons", metiers: ["ONGLES"] },
  { slug: "beauty-salons", metiers: ["ESTHETIQUE"] },
  { slug: "spas", metiers: ["SPA"] },
];

export function freshaTargets(zones: Zone[]): SweepTarget[] {
  if (zones.length === 0) return [];
  return BUSINESS_TYPES.map((bt) => ({
    source: "FRESHA" as const,
    url: `${BASE}/lp/en/bt/${bt.slug}/in/fr-paris-paris`,
    metiers: bt.metiers,
    label: `fresha ${bt.slug} paris`,
  }));
}
