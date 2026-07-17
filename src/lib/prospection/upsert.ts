import { prisma } from "@/lib/db";
import type { CrawledProspect, CrawlLog } from "@/lib/prospection/crawl";
import { matchCrmSalon, normalizeBookingUrl, normalizeName, postalFromArrondissement, type CrmIndex } from "@/lib/prospection/match";

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

export function minReviews(): number {
  const parsed = Number(process.env.PROSPECT_MIN_REVIEWS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 50;
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
  };
}

export async function upsertProspects(
  prospects: CrawledProspect[],
  log: CrawlLog = () => {},
): Promise<UpsertCounts> {
  const threshold = minReviews();
  const kept = prospects.filter((p) => p.reviewCount >= threshold);
  log(`${kept.length}/${prospects.length} salons avec ≥${threshold} avis`);

  const index = await loadCrmIndex();
  const existingRows = await prisma.prospect.findMany({
    where: { sourceUrl: { in: kept.map((p) => p.sourceUrl) } },
    select: { id: true, sourceUrl: true, status: true, metiers: true },
  });
  const existingByUrl = new Map(existingRows.map((row) => [row.sourceUrl, row]));

  const now = new Date();
  const counts: UpsertCounts = { kept: kept.length, created: 0, updated: 0, alreadyInCrm: 0 };

  for (const prospect of kept) {
    const matchedSalonId = matchCrmSalon(prospect, index);
    if (matchedSalonId) counts.alreadyInCrm++;

    const existing = existingByUrl.get(prospect.sourceUrl);
    if (!existing) {
      await prisma.prospect.create({
        data: {
          ...refreshedFields(prospect, now),
          metiers: prospect.metiers,
          source: prospect.source,
          sourceUrl: prospect.sourceUrl,
          status: matchedSalonId ? "DEJA_CRM" : "NOUVEAU",
          matchedSalonId,
          firstSeenAt: now,
        },
      });
      counts.created++;
      continue;
    }

    // Only NOUVEAU can flip to DEJA_CRM — never touch tournée/manual statuses.
    const status = existing.status === "NOUVEAU" && matchedSalonId ? "DEJA_CRM" : existing.status;
    await prisma.prospect.update({
      where: { id: existing.id },
      data: {
        ...refreshedFields(prospect, now),
        metiers: [...new Set([...existing.metiers, ...prospect.metiers])],
        status,
        matchedSalonId,
      },
    });
    counts.updated++;
  }

  return counts;
}
