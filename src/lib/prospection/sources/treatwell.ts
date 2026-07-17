import type { Metier } from "@/generated/prisma/enums";
import type { SweepTarget } from "@/lib/prospection/types";
import type { Zone } from "@/lib/prospection/zones";

// Treatwell browse pages are server-rendered with a JSON-LD ItemList.
// URL shape: /salons/{category}/offre-type-local/dans-{location}/[page-N/]
// Locations: "11e-arrondissement-paris-fr" (Paris) or "{city-slug}-france" (towns).

const BASE = "https://www.treatwell.fr";

const CATEGORIES: ReadonlyArray<{ slug: string; metiers: Metier[] }> = [
  { slug: "soins-groupe-coiffure", metiers: ["COIFFURE"] },
  { slug: "soin-barbier-et-rasage-homme,coloration-cheveux-homme,coupe-homme", metiers: ["BARBIER"] },
  { slug: "soins-groupe-manucure-et-beaute-des-pieds", metiers: ["ONGLES"] },
  { slug: "soins-groupe-visage", metiers: ["ESTHETIQUE"] },
  { slug: "soins-groupe-epilation", metiers: ["ESTHETIQUE"] },
  { slug: "soins-groupe-massage", metiers: ["SPA"] },
];

function locationSlug(zone: Zone): string {
  if (zone.dept === "75") {
    const n = Number(zone.slug.split("-")[1]);
    return `${n === 1 ? "1er" : `${n}e`}-arrondissement-paris-fr`;
  }
  return `${zone.citySlug}-france`;
}

export function treatwellTargets(zones: Zone[]): SweepTarget[] {
  return zones.flatMap((zone) =>
    CATEGORIES.map((category) => ({
      source: "TREATWELL" as const,
      url: `${BASE}/salons/${category.slug}/offre-type-local/dans-${locationSlug(zone)}/`,
      metiers: category.metiers,
      label: `treatwell ${category.slug} ${zone.slug}`,
    })),
  );
}

export function treatwellPageUrl(targetUrl: string, page: number): string {
  return page <= 1 ? targetUrl : `${targetUrl}page-${page}/`;
}

// Highest page number linked from the listing HTML (1 when unpaginated).
export function treatwellMaxPage(html: string): number {
  const pages = [...html.matchAll(/href="[^"]*\/page-(\d+)\/"/g)].map((m) => Number(m[1]));
  return pages.length ? Math.max(...pages) : 1;
}
