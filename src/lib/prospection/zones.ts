// Prospecting zones: the 20 Paris arrondissements + petite couronne towns.
// Sources return listings with a postal code; zone assignment always goes
// through zoneForPostalCode so every source shares the same bucketing.

export type ZoneDept = "75" | "92" | "93" | "94";

export type Zone = {
  slug: string; // "paris-11" | "boulogne-billancourt"
  label: string; // "Paris 11e" | "Boulogne-Billancourt"
  dept: ZoneDept;
  postalCodes: string[]; // postal codes bucketed into this zone
  citySlug?: string; // URL slug on city-based directories (towns only)
};

function arrondissement(n: number): Zone {
  const postal = `750${String(n).padStart(2, "0")}`;
  return {
    slug: `paris-${n}`,
    label: `Paris ${n === 1 ? "1er" : `${n}e`}`,
    dept: "75",
    // 75116 is the second postal code of the 16e.
    postalCodes: n === 16 ? [postal, "75116"] : [postal],
  };
}

function town(citySlug: string, label: string, dept: ZoneDept, postalCodes: string[]): Zone {
  return { slug: citySlug, label, dept, postalCodes, citySlug };
}

export const ZONES: Zone[] = [
  ...Array.from({ length: 20 }, (_, i) => arrondissement(i + 1)),
  // Hauts-de-Seine (92)
  town("boulogne-billancourt", "Boulogne-Billancourt", "92", ["92100"]),
  town("neuilly-sur-seine", "Neuilly-sur-Seine", "92", ["92200"]),
  town("levallois-perret", "Levallois-Perret", "92", ["92300"]),
  town("courbevoie", "Courbevoie", "92", ["92400"]),
  town("asnieres-sur-seine", "Asnières-sur-Seine", "92", ["92600"]),
  town("colombes", "Colombes", "92", ["92700"]),
  town("nanterre", "Nanterre", "92", ["92000"]),
  town("rueil-malmaison", "Rueil-Malmaison", "92", ["92500"]),
  town("issy-les-moulineaux", "Issy-les-Moulineaux", "92", ["92130"]),
  town("clichy", "Clichy", "92", ["92110"]),
  town("puteaux", "Puteaux", "92", ["92800"]),
  town("montrouge", "Montrouge", "92", ["92120"]),
  town("clamart", "Clamart", "92", ["92140"]),
  town("antony", "Antony", "92", ["92160"]),
  // Seine-Saint-Denis (93)
  town("saint-denis", "Saint-Denis", "93", ["93200", "93210"]),
  town("montreuil", "Montreuil", "93", ["93100"]),
  town("aubervilliers", "Aubervilliers", "93", ["93300"]),
  town("saint-ouen", "Saint-Ouen", "93", ["93400"]),
  town("pantin", "Pantin", "93", ["93500"]),
  town("bobigny", "Bobigny", "93", ["93000"]),
  town("bondy", "Bondy", "93", ["93140"]),
  town("aulnay-sous-bois", "Aulnay-sous-Bois", "93", ["93600"]),
  town("rosny-sous-bois", "Rosny-sous-Bois", "93", ["93110"]),
  town("noisy-le-grand", "Noisy-le-Grand", "93", ["93160"]),
  // Val-de-Marne (94)
  town("creteil", "Créteil", "94", ["94000"]),
  town("vitry-sur-seine", "Vitry-sur-Seine", "94", ["94400"]),
  town("ivry-sur-seine", "Ivry-sur-Seine", "94", ["94200"]),
  town("vincennes", "Vincennes", "94", ["94300"]),
  town("saint-maur-des-fosses", "Saint-Maur-des-Fossés", "94", ["94100", "94210"]),
  town("champigny-sur-marne", "Champigny-sur-Marne", "94", ["94500"]),
  town("maisons-alfort", "Maisons-Alfort", "94", ["94700"]),
  town("fontenay-sous-bois", "Fontenay-sous-Bois", "94", ["94120"]),
  town("nogent-sur-marne", "Nogent-sur-Marne", "94", ["94130"]),
  town("charenton-le-pont", "Charenton-le-Pont", "94", ["94220"]),
];

export const ZONE_BY_SLUG: ReadonlyMap<string, Zone> = new Map(ZONES.map((z) => [z.slug, z]));

const ZONE_BY_POSTAL: ReadonlyMap<string, Zone> = new Map(
  ZONES.flatMap((z) => z.postalCodes.map((cp) => [cp, z] as const)),
);

export function zoneForPostalCode(postalCode: string | null | undefined): Zone | null {
  if (!postalCode) return null;
  return ZONE_BY_POSTAL.get(postalCode.trim()) ?? null;
}

export function zoneLabel(slug: string | null | undefined): string {
  if (!slug) return "Hors zone";
  return ZONE_BY_SLUG.get(slug)?.label ?? slug;
}
