import type { Metier } from "@/generated/prisma/enums";
import type { SweepTarget } from "@/lib/prospection/types";
import type { Zone } from "@/lib/prospection/zones";

// Booksy browse pages are server-rendered with a JSON-LD ItemList (top ~20,
// no pagination). URL shape: /fr-fr/s/{category}/{locationId}_{location-slug}
// Location ids were harvested from booksy.com/sitemap/fr/sitemap_category_C_*.xml.gz
// (only Paris arrondissements: town slugs like "montreuil"/"boulogne" are
// ambiguous with other French cities, and Booksy listings carry no postal code).
// Regenerate by re-filtering those sitemaps if Booksy renumbers locations.

const BASE = "https://booksy.com";

const CATEGORY_METIERS: Record<string, Metier[]> = {
  "salon-de-coiffure": ["COIFFURE"],
  barbier: ["BARBIER"],
  onglerie: ["ONGLES"],
  "instituts-de-beaute": ["ESTHETIQUE"],
  epilation: ["ESTHETIQUE"],
  "spa-massage": ["SPA"],
};

const LOCATION_BY_ZONE: Record<string, string> = {
  "paris-1": "123668_paris-1er",
  "paris-2": "123669_paris-2eme",
  "paris-3": "123670_paris-3eme",
  "paris-4": "123671_paris-4eme",
  "paris-5": "123672_paris-5eme",
  "paris-6": "123673_paris-6eme",
  "paris-7": "123674_paris-7eme",
  "paris-8": "123675_paris-8eme",
  "paris-9": "123676_paris-9eme",
  "paris-10": "123677_paris-10eme",
  "paris-11": "123678_paris-11eme",
  "paris-12": "123679_paris-12eme",
  "paris-13": "123680_paris-13eme",
  "paris-14": "123681_paris-14eme",
  "paris-15": "123682_paris-15eme",
  "paris-16": "123683_paris-16eme",
  "paris-17": "123684_paris-17eme",
  "paris-18": "123685_paris-18eme",
  "paris-19": "123686_paris-19eme",
  "paris-20": "123687_paris-20eme",
};

// Category × arrondissement pages that actually exist per the sitemaps.
const ZONES_BY_CATEGORY: Record<string, string[]> = {
  barbier: ["paris-1", "paris-2", "paris-3", "paris-4", "paris-5", "paris-6", "paris-7", "paris-8", "paris-9", "paris-10", "paris-11", "paris-12", "paris-13", "paris-14", "paris-15", "paris-16", "paris-17", "paris-19", "paris-20"],
  epilation: ["paris-1", "paris-2", "paris-3", "paris-5", "paris-6", "paris-7", "paris-8", "paris-9", "paris-10", "paris-11", "paris-12", "paris-13", "paris-14", "paris-15", "paris-16", "paris-17", "paris-18", "paris-19"],
  "instituts-de-beaute": ["paris-1", "paris-2", "paris-3", "paris-5", "paris-6", "paris-7", "paris-9", "paris-10", "paris-11", "paris-12", "paris-14", "paris-15", "paris-16", "paris-17", "paris-19"],
  onglerie: ["paris-1", "paris-2", "paris-3", "paris-5", "paris-6", "paris-7", "paris-8", "paris-9", "paris-10", "paris-11", "paris-12", "paris-13", "paris-14", "paris-15", "paris-16", "paris-17", "paris-18", "paris-19"],
  "salon-de-coiffure": ["paris-1", "paris-2", "paris-3", "paris-4", "paris-5", "paris-6", "paris-7", "paris-8", "paris-9", "paris-10", "paris-11", "paris-12", "paris-13", "paris-15", "paris-16", "paris-17", "paris-18", "paris-19", "paris-20"],
  "spa-massage": ["paris-1", "paris-2", "paris-5", "paris-6", "paris-7", "paris-8", "paris-9", "paris-10", "paris-11", "paris-12", "paris-13", "paris-14", "paris-15", "paris-16", "paris-17"],
};

export function booksyTargets(zones: Zone[]): SweepTarget[] {
  const wanted = new Set(zones.map((z) => z.slug));
  return Object.entries(ZONES_BY_CATEGORY).flatMap(([category, categoryZones]) =>
    categoryZones
      .filter((zoneSlug) => wanted.has(zoneSlug))
      .map((zoneSlug) => ({
        source: "BOOKSY" as const,
        url: `${BASE}/fr-fr/s/${category}/${LOCATION_BY_ZONE[zoneSlug]}`,
        metiers: CATEGORY_METIERS[category],
        label: `booksy ${category} ${zoneSlug}`,
        zoneHint: zoneSlug,
      })),
  );
}
