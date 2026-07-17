import type { Metier } from "@/generated/prisma/enums";
import type { SweepTarget } from "@/lib/prospection/types";
import type { Zone } from "@/lib/prospection/zones";

// Planity directory pages are server-rendered with a JSON-LD ItemList.
// URL shape: /{category}/{location}[/page-N]
// Locations: "paris-75" (whole department, salons carry their postal code)
// or "{postal}-{city-slug}" for petite couronne towns.

const BASE = "https://www.planity.com";

const CATEGORIES: ReadonlyArray<{ slug: string; metiers: Metier[] }> = [
  { slug: "coiffeur", metiers: ["COIFFURE"] },
  { slug: "barbier", metiers: ["BARBIER"] },
  { slug: "manucure-et-pedicure", metiers: ["ONGLES"] },
  { slug: "institut-de-beaute", metiers: ["ESTHETIQUE"] },
];

// One shared "paris-75" target covers every Paris arrondissement (zone
// assignment happens by postal code), town zones get their own page.
export function planityTargets(zones: Zone[]): SweepTarget[] {
  const locations = new Map<string, string>(); // location slug -> label
  for (const zone of zones) {
    if (zone.dept === "75") locations.set("paris-75", "paris");
    else locations.set(`${zone.postalCodes[0]}-${zone.citySlug}`, zone.slug);
  }

  return [...locations.entries()].flatMap(([location, label]) =>
    CATEGORIES.map((category) => ({
      source: "PLANITY" as const,
      url: `${BASE}/${category.slug}/${location}`,
      metiers: category.metiers,
      label: `planity ${category.slug} ${label}`,
    })),
  );
}

export function planityPageUrl(targetUrl: string, page: number): string {
  return page <= 1 ? targetUrl : `${targetUrl}/page-${page}`;
}

export function planityMaxPage(html: string): number {
  const pages = [...html.matchAll(/href="[^"]*\/page-(\d+)"/g)].map((m) => Number(m[1]));
  return pages.length ? Math.max(...pages) : 1;
}
