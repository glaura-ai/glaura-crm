import { prisma } from "@/lib/db";
import type { CrawledProspect, CrawlLog } from "@/lib/prospection/crawl";
import { matchCrmSalon, normalizeBookingUrl, normalizeName, postalFromArrondissement, type CrmIndex } from "@/lib/prospection/match";
import { sameDirectoryBusiness } from "@/lib/prospection/directory-match";
import { tierForProspect } from "@/lib/prospection/tier";

// Persists crawled listings as Prospect rows:
//  - keeps only salons with enough reviews (PROSPECT_MIN_REVIEWS, default 50)
//  - upserts by sourceUrl (re-runs refresh counts, never duplicate)
//  - flags salons already present in the CRM (booking URL or name+postal match)
//    as DEJA_CRM so tournées never include them.

export type UpsertCounts = {
  kept: number;
  created: number;
  updated: number;
  alreadyInCrm: number;
};

// Directory sweeps only. A salon worth calling is small and independent, not
// inactive — 100 reviews is the floor for "this place actually takes bookings".
// Instagram-discovered prospects bypass this entirely: they have no directory
// listing and so no review count, and are gated on follower count instead.
export function minReviews(): number {
  const parsed = Number(process.env.PROSPECT_MIN_REVIEWS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 100;
}

export async function loadCrmIndex(): Promise<CrmIndex> {
  const salons = await prisma.salon.findMany({
    select: { id: true, name: true, bookingUrl: true, arrondissement: true },
  });

  const byBookingUrl = new Map<string, string>();
  const byNamePostal = new Map<string, string>();
  for (const salon of salons) {
    const url = salon.bookingUrl ? normalizeBookingUrl(salon.bookingUrl) : null;
    if (url) byBookingUrl.set(url, salon.id);
    const postal = postalFromArrondissement(salon.arrondissement);
    if (postal) byNamePostal.set(`${normalizeName(salon.name)}|${postal}`, salon.id);
  }
  return { byBookingUrl, byNamePostal };
}

function prospectAddress(prospect: CrawledProspect): string | null {
  if (!prospect.street) return null;
  return `${prospect.street}, ${prospect.postalCode ?? ""} ${prospect.city ?? ""}`.trim().replace(/,\s*$/, "");
}

function refreshedFields(prospect: CrawledProspect, now: Date) {
  return {
    name: prospect.name,
    zone: prospect.zone,
    address: prospectAddress(prospect),
    postalCode: prospect.postalCode,
    city: prospect.city,
    rating: prospect.rating,
    reviewCount: prospect.reviewCount,
    lastSeenAt: now,
    ...(prospect.source === "TREATWELL" ? { treatwellUrl: prospect.sourceUrl } : {}),
    ...(prospect.source === "PLANITY" ? { planityUrl: prospect.sourceUrl } : {}),
    ...(prospect.treatwellUrl ? { treatwellUrl: prospect.treatwellUrl } : {}),
    ...(prospect.planityUrl ? { planityUrl: prospect.planityUrl } : {}),
    ...(prospect.dualPlatformCheckedAt ? { dualPlatformCheckedAt: prospect.dualPlatformCheckedAt } : {}),
  };
}

export async function upsertProspects(
  prospects: CrawledProspect[],
  log: CrawlLog = () => {},
  options: { minReviewCount?: number } = {},
): Promise<UpsertCounts> {
  const threshold = options.minReviewCount ?? minReviews();
  const kept = prospects.filter((p) => p.reviewCount >= threshold);
  log(`${kept.length}/${prospects.length} salons avec ≥${threshold} avis`);

  const index = await loadCrmIndex();
  const existingRows = await prisma.prospect.findMany({
    where: { OR: [{ sourceUrl: { in: kept.flatMap(p => [p.sourceUrl, ...(p.planityUrl ? [p.planityUrl] : []), ...(p.treatwellUrl ? [p.treatwellUrl] : [])]) } }, { postalCode: { in: kept.flatMap(p => p.postalCode ? [p.postalCode] : []) } }] },
    select: {
      id: true,
      name: true,
      postalCode: true,
      address: true,
      treatwellUrl: true,
      planityUrl: true,
      sourceUrl: true,
      status: true,
      metiers: true,
      instagramFollowers: true,
      googleReviewCount: true,
    },
  });
  const cachedRows = new Map(existingRows.map(row => [row.id, row]));
  const existingByUrl = new Map<string, (typeof existingRows)[number]>();
  function cacheRow(row: (typeof existingRows)[number]) {
    cachedRows.set(row.id, row);
    for (const url of [row.sourceUrl, row.treatwellUrl, row.planityUrl]) if (url) existingByUrl.set(url, row);
  }
  existingRows.forEach(cacheRow);
  const candidatesByNamePostal = (key: string) => [...cachedRows.values()].filter(row => `${normalizeName(row.name)}|${row.postalCode}` === key);

  const now = new Date();
  const counts: UpsertCounts = { kept: kept.length, created: 0, updated: 0, alreadyInCrm: 0 };

  for (const prospect of kept) {
    const matchedSalonId = matchCrmSalon(prospect, index);
    if (matchedSalonId) counts.alreadyInCrm++;

    const namePostal = prospect.postalCode ? `${normalizeName(prospect.name)}|${prospect.postalCode}` : null;
    const candidates = namePostal ? candidatesByNamePostal(namePostal).filter(row => sameDirectoryBusiness(prospect, { name: row.name, postalCode: row.postalCode, street: row.address })) : [];
    const existing = existingByUrl.get(prospect.sourceUrl)
      ?? (prospect.planityUrl ? existingByUrl.get(prospect.planityUrl) : undefined)
      ?? existingRows.find(row => row.treatwellUrl === prospect.sourceUrl || row.planityUrl === prospect.sourceUrl)
      ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!existing) {
      const created = await prisma.prospect.create({
        data: {
          ...refreshedFields(prospect, now),
          metiers: prospect.metiers,
          source: prospect.source,
          sourceUrl: prospect.sourceUrl,
          status: matchedSalonId ? "DEJA_CRM" : "NOUVEAU",
          matchedSalonId,
          // New prospects have no Instagram yet — the enrichment cron tiers them.
          tier: tierForProspect({ instagramFollowers: null }),
          firstSeenAt: now,
        },
      });
      cacheRow(created);
      counts.created++;
      continue;
    }

    // Only NOUVEAU can flip to DEJA_CRM — never touch tournée/manual statuses.
    const status = existing.status === "NOUVEAU" && matchedSalonId ? "DEJA_CRM" : existing.status;
    const updated = await prisma.prospect.update({
      where: { id: existing.id },
      data: {
        ...refreshedFields(prospect, now),
        metiers: [...new Set([...existing.metiers, ...prospect.metiers])],
        status,
        matchedSalonId,
        // Tier follows Instagram, so a refreshed review count cannot change it —
        // recomputed anyway to stay correct if the rule changes.
        tier: tierForProspect({ instagramFollowers: existing.instagramFollowers }),
      },
    });
    cacheRow(updated);
    counts.updated++;
  }

  return counts;
}
