import { prisma } from "@/lib/db";
import { crawlTargets } from "./crawl";
import { buildTargets } from "./sources";
import { ZONE_BY_SLUG } from "./zones";
import { intersectDirectories } from "./directory-match";
import { upsertProspects } from "./upsert";

export async function pullTreatwellPlanity(zoneSlug: string, limit: number, log: (message: string) => void = () => {}) {
  const zone = ZONE_BY_SLUG.get(zoneSlug);
  if (!zone) throw new Error("Zone inconnue.");
  log("Lecture des fiches Treatwell et Planity…");
  const crawl = await crawlTargets(buildTargets(["TREATWELL", "PLANITY"], [zone]), log);
  const local = crawl.prospects.filter(p => p.postalCode && zone.postalCodes.includes(p.postalCode));
  const { pairs, ambiguous, unmatched } = intersectDirectories(local.filter(p => p.source === "TREATWELL"), local.filter(p => p.source === "PLANITY"));
  let created = 0; let updated = 0; let duplicates = 0;
  for (const pair of pairs.slice(0, limit)) {
    const urls = [pair.treatwell.sourceUrl, pair.planity.sourceUrl];
    const existing = await prisma.prospect.findMany({ where: { OR: [{ sourceUrl: { in: urls } }, { treatwellUrl: pair.treatwell.sourceUrl }, { planityUrl: pair.planity.sourceUrl }] }, select: { id: true } });
    // Preserve assignments and history: two pre-existing leads require a human to reconcile them.
    if (existing.length > 1) { duplicates++; continue; }
    const result = await upsertProspects([{
      ...pair.treatwell,
      metiers: [...new Set([...pair.treatwell.metiers, ...pair.planity.metiers])],
      treatwellUrl: pair.treatwell.sourceUrl,
      planityUrl: pair.planity.sourceUrl,
      dualPlatformCheckedAt: new Date(),
    }], log, { minReviewCount: 0 });
    created += result.created; updated += result.updated;
  }
  if (crawl.errors.length && !pairs.length) throw new Error("Les annuaires n’ont pas pu être lus intégralement. Réessayez avant de conclure à l’absence de correspondances.");
  return `${created} nouveau(x) salon(s), ${updated} fiche(s) actualisée(s) avec présence Treatwell + Planity vérifiée. ${pairs.length} correspondance(s) trouvée(s), limite de ${limit} par traitement. ${unmatched} fiche(s) Treatwell sans correspondance certaine dans les pages lues ; ${ambiguous} rapprochement(s) ambigu(s), ${duplicates} doublon(s) existant(s) à vérifier. ${crawl.errors.length ? `${crawl.errors.length} page(s) en erreur : résultats partiels.` : ""}`;
}
