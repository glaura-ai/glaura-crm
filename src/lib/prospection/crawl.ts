import type { Metier, ProspectSource } from "@/generated/prisma/enums";
import { extractBusinesses, type RawBusiness } from "@/lib/prospection/jsonld";
import { fetchHtml, HttpStatusError, sleep, throttleMs } from "@/lib/prospection/http";
import { planityMaxPage, planityPageUrl } from "@/lib/prospection/sources/planity";
import { treatwellMaxPage, treatwellPageUrl } from "@/lib/prospection/sources/treatwell";
import type { SweepTarget } from "@/lib/prospection/types";
import { zoneForPostalCode } from "@/lib/prospection/zones";

// A listing after crawling: deduped by sourceUrl, métiers merged across
// the category pages it appeared on, zone resolved from its postal code.
export type CrawledProspect = {
  source: ProspectSource;
  sourceUrl: string;
  name: string;
  zone: string | null;
  metiers: Metier[];
  rating: number | null;
  reviewCount: number;
  street: string | null;
  postalCode: string | null;
  city: string | null;
};

export type CrawlLog = (message: string) => void;

export type CrawlResult = {
  prospects: CrawledProspect[];
  pagesFetched: number;
  listingsParsed: number;
  errors: string[];
};

function maxPagesCap(): number {
  const parsed = Number(process.env.PROSPECT_MAX_PAGES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

type Pagination = {
  pageUrl: (targetUrl: string, page: number) => string;
  maxPage: (html: string) => number;
};

const PAGINATION: Partial<Record<ProspectSource, Pagination>> = {
  TREATWELL: { pageUrl: treatwellPageUrl, maxPage: treatwellMaxPage },
  PLANITY: { pageUrl: planityPageUrl, maxPage: planityMaxPage },
};

function normalizeSourceUrl(url: string, base: string): string | null {
  try {
    const parsed = new URL(url, base);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function mergeBusiness(
  byUrl: Map<string, CrawledProspect>,
  business: RawBusiness,
  target: SweepTarget,
): boolean {
  if (!business.url) return false;
  const sourceUrl = normalizeSourceUrl(business.url, target.url);
  if (!sourceUrl) return false;

  const existing = byUrl.get(sourceUrl);
  if (existing) {
    const metiers = [...new Set([...existing.metiers, ...target.metiers])];
    byUrl.set(sourceUrl, { ...existing, metiers });
    return true;
  }

  const zone = zoneForPostalCode(business.postalCode)?.slug ?? target.zoneHint ?? null;
  byUrl.set(sourceUrl, {
    source: target.source,
    sourceUrl,
    name: business.name,
    zone,
    metiers: [...target.metiers],
    rating: business.rating,
    reviewCount: business.reviewCount ?? 0,
    street: business.street,
    postalCode: business.postalCode,
    city: business.city,
  });
  return true;
}

async function crawlTarget(
  target: SweepTarget,
  byUrl: Map<string, CrawledProspect>,
  result: { pagesFetched: number; listingsParsed: number; errors: string[] },
  log: CrawlLog,
): Promise<void> {
  const pagination = PAGINATION[target.source];
  const cap = pagination ? maxPagesCap() : 1;
  let maxPage = 1;

  for (let page = 1; page <= Math.min(maxPage, cap); page++) {
    const url = pagination ? pagination.pageUrl(target.url, page) : target.url;
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 404) {
        log(`  ${target.label} page ${page}: 404, page ignorée`);
        return; // missing page: the rest of the pagination won't exist either
      }
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${target.label} page ${page}: ${message}`);
      log(`  ${target.label} page ${page}: ERREUR ${message}`);
      if (page === 1) return; // no pagination info without page 1
      continue; // transient failure mid-pagination: keep crawling the rest
    }

    result.pagesFetched++;
    if (page === 1 && pagination) maxPage = pagination.maxPage(html);

    const businesses = extractBusinesses(html);
    let merged = 0;
    for (const business of businesses) {
      if (mergeBusiness(byUrl, business, target)) merged++;
    }
    result.listingsParsed += merged;
    log(`  ${target.label} page ${page}/${Math.min(maxPage, cap)}: ${merged} salons`);

    if (businesses.length === 0) return; // empty page — stop paginating this target
    await sleep(throttleMs());
  }
}

export async function crawlTargets(targets: SweepTarget[], log: CrawlLog = () => {}): Promise<CrawlResult> {
  const byUrl = new Map<string, CrawledProspect>();
  const result = { pagesFetched: 0, listingsParsed: 0, errors: [] as string[] };

  for (const target of targets) {
    await crawlTarget(target, byUrl, result, log);
  }

  return { prospects: [...byUrl.values()], ...result };
}
