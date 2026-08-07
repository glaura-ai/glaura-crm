/**
 * Pure diff engine for re-syncing an onboarded salon's Firestore `services`
 * against a fresh scrape of its booking page (Planity/Treatwell/…).
 *
 * The booking page is the source of truth:
 *   - matched service drifted        → update (price/duration/rename)
 *   - on page, missing in Firestore  → create
 *   - on page, soft-deleted doc      → restore (at the page's price)
 *   - active doc, gone from page     → deactivate (soft, reversible)
 *
 * Matching is by normalized name (case/accent/whitespace-insensitive), with
 * an optional caller-supplied alias map for renames the salon made on the
 * page ("Pose volume russe" → "Pose volume russe léger"). Exact matches are
 * resolved before aliases so an alias can never steal a doc that a same-named
 * scraped row already claims. No I/O here — the CLI owns Firestore access.
 */

import { variantKeyForServiceName } from "./account-model";

export interface ExistingService {
  id: string;
  service_name: string;
  service_price: number;
  duration_minutes: number | null;
  discounted_price: number;
  isActive: boolean;
  isDeleted: boolean;
}

/** The subset of an ExtractedService the diff needs (CLI passes the full object through). */
export interface ScrapedService {
  service_name: string;
  service_price: number;
  duration_minutes: number | null;
}

export interface ServiceUpdate {
  id: string;
  service_name: string;
  changes: {
    service_name?: string;
    service_price?: number;
    discounted_price?: number;
    duration_minutes?: number;
    /** Set when a paused (inactive, non-deleted) doc matched the live page. */
    isActive?: true;
  };
  before?: { service_price: number; duration_minutes: number | null };
}

export interface ServiceRestore {
  id: string;
  service_name: string;
  changes: {
    isActive: true;
    isDeleted: false;
    service_price: number;
    discounted_price: 0;
    duration_minutes?: number;
  };
}

export interface ServiceDiff<S extends ScrapedService = ScrapedService> {
  unchanged: Array<{ id: string; service_name: string }>;
  updates: ServiceUpdate[];
  restores: ServiceRestore[];
  creates: S[];
  deactivates: Array<{ id: string; service_name: string }>;
  /**
   * Live docs absent from the scrape but NOT safe to auto-deactivate: 0€
   * ("sur devis") services, which the extraction policy may legitimately
   * skip — their absence from a scrape is not proof they left the page.
   */
  kept: Array<{ id: string; service_name: string }>;
}

export interface DiffOptions {
  /** scraped service name → existing service name, for renames on the page. */
  aliases?: Record<string, string>;
}

/** Normalized match key: lowercase, accent-stripped, whitespace-collapsed, apostrophes folded. */
export function serviceMatchKey(name: string): string {
  return variantKeyForServiceName(name.replace(/[‘’ʼ`]/g, "'"));
}

function dedupeScraped<S extends ScrapedService>(scraped: readonly S[]): S[] {
  const seen = new Set<string>();
  const out: S[] = [];
  for (const svc of scraped) {
    const key = `${serviceMatchKey(svc.service_name)}|${svc.service_price}|${svc.duration_minutes ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(svc);
  }
  return out;
}

function groupByKey<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/**
 * Claims the unclaimed existing doc whose price sits closest to the scraped
 * price. Live docs always win over soft-deleted ones — a deleted doc is only
 * paired (restored) when no live candidate with the same name remains.
 */
function claimClosest(
  candidates: ExistingService[],
  claimed: Set<string>,
  price: number,
): ExistingService | null {
  let best: ExistingService | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (claimed.has(candidate.id)) continue;
    if (best && !best.isDeleted && candidate.isDeleted) continue;
    const distance = Math.abs(candidate.service_price - price);
    const beatsOnLiveness = best !== null && best.isDeleted && !candidate.isDeleted;
    // Tie-break on doc id so results don't depend on Firestore read order.
    const beatsOnId = best !== null && distance === bestDistance && candidate.id < best.id;
    if (beatsOnLiveness || distance < bestDistance || beatsOnId || best === null) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best) claimed.add(best.id);
  return best;
}

function buildUpdate(doc: ExistingService, svc: ScrapedService, newName?: string): ServiceUpdate | null {
  const changes: ServiceUpdate["changes"] = {};
  if (newName && newName !== doc.service_name) changes.service_name = newName;
  if (svc.service_price !== doc.service_price) {
    changes.service_price = svc.service_price;
    // A discounted_price mirroring the old price is "no discount" in disguise
    // (the app treats 0 the same way) — keep it tracking the new price. A
    // real discount left above the new price would be nonsense; clamp it.
    const mirrored = doc.discounted_price === doc.service_price && doc.discounted_price !== 0;
    const nowAbovePrice = doc.discounted_price > svc.service_price;
    if (mirrored || nowAbovePrice) changes.discounted_price = svc.service_price;
  }
  if (svc.duration_minutes != null && svc.duration_minutes !== doc.duration_minutes) {
    changes.duration_minutes = svc.duration_minutes;
  }
  // The page still lists it — a paused (inactive, non-deleted) doc comes back.
  if (!doc.isActive) changes.isActive = true;
  if (Object.keys(changes).length === 0) return null;
  return {
    id: doc.id,
    service_name: doc.service_name,
    changes,
    before: { service_price: doc.service_price, duration_minutes: doc.duration_minutes },
  };
}

function buildRestore(doc: ExistingService, svc: ScrapedService): ServiceRestore {
  const changes: ServiceRestore["changes"] = {
    isActive: true,
    isDeleted: false,
    service_price: svc.service_price,
    discounted_price: 0,
  };
  if (svc.duration_minutes != null) changes.duration_minutes = svc.duration_minutes;
  return { id: doc.id, service_name: doc.service_name, changes };
}

export function diffServices<S extends ScrapedService>(
  existing: readonly ExistingService[],
  scraped: readonly S[],
  options: DiffOptions = {},
): ServiceDiff<S> {
  const scrapedRows = dedupeScraped(scraped);
  const existingByKey = groupByKey(existing, (doc) => serviceMatchKey(doc.service_name));
  const aliasByScrapedKey = new Map<string, string>(
    Object.entries(options.aliases ?? {}).map(([from, to]) => [serviceMatchKey(from), serviceMatchKey(to)]),
  );

  const claimed = new Set<string>();
  const diff: ServiceDiff<S> = { unchanged: [], updates: [], restores: [], creates: [], deactivates: [], kept: [] };

  // Pass 1 — exact-name matches claim their docs first.
  const unmatchedScraped: S[] = [];
  for (const svc of scrapedRows) {
    const key = serviceMatchKey(svc.service_name);
    const doc = claimClosest(existingByKey.get(key) ?? [], claimed, svc.service_price);
    if (!doc) {
      unmatchedScraped.push(svc);
      continue;
    }
    applyMatch(diff, doc, svc);
  }

  // Pass 2 — aliases pair renamed page entries with leftover docs.
  for (const svc of unmatchedScraped) {
    const aliasKey = aliasByScrapedKey.get(serviceMatchKey(svc.service_name));
    const doc = aliasKey ? claimClosest(existingByKey.get(aliasKey) ?? [], claimed, svc.service_price) : null;
    if (!doc) {
      diff.creates.push(svc);
      continue;
    }
    applyMatch(diff, doc, svc, svc.service_name);
  }

  // Pass 3 — live docs the page no longer carries get deactivated. 0€
  // ("sur devis") docs are kept: extraction may skip such rows, so their
  // absence from the scrape is not evidence they left the page.
  for (const doc of existing) {
    if (claimed.has(doc.id) || doc.isDeleted) continue;
    if (doc.service_price === 0) diff.kept.push({ id: doc.id, service_name: doc.service_name });
    else diff.deactivates.push({ id: doc.id, service_name: doc.service_name });
  }

  return diff;
}

function applyMatch<S extends ScrapedService>(diff: ServiceDiff<S>, doc: ExistingService, svc: ScrapedService, newName?: string): void {
  if (doc.isDeleted) {
    diff.restores.push(buildRestore(doc, svc));
    return;
  }
  const update = buildUpdate(doc, svc, newName);
  if (update) diff.updates.push(update);
  else diff.unchanged.push({ id: doc.id, service_name: doc.service_name });
}
