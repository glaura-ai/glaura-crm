/**
 * Haiku-based salon-data extractor (Step P2 of the onboarding pipeline).
 *
 * Input: the fully-expanded page HTML produced by `expandSalonPage()`
 * (see ./expand.ts). Output: a validated `SalonExtract` object describing
 * the salon (name/address/phone/bio/images/hours), its services, best-effort
 * staff names, and (optionally) reviews.
 *
 * Two stages:
 *   1. `trimHtmlForExtraction()` — deterministic, no LLM. Uses cheerio to
 *      pull the handful of fields we actually need (schema.org JSON-LD when
 *      present, microdata ids, and the deterministic collector element the
 *      expander leaves behind for Treatwell) out of the ~1.4-1.9MB expanded
 *      HTML and renders them as a compact plain-text block. This is what
 *      keeps the Haiku call small and cheap.
 *   2. `extractSalon()` — sends that trimmed text to `claude-haiku-4-5`
 *      with a Zod structured-output schema and returns the parsed result.
 *
 * Plain TS module (no Next.js imports) so it can run from a CLI script or a
 * worker, same as expand.ts.
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GLAURA_CATEGORY_NAMES } from "./categories";
import type { SourceType } from "./expand";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// Intentionally loose: no min/max/length constraints, since Anthropic
// structured outputs only support a subset of JSON Schema keywords.
const DayHoursSchema = z.union([
  z.object({ open: z.string(), close: z.string() }),
  z.literal("closed"),
]);

const HoursSchema = z.object({
  Mon: DayHoursSchema.nullable().optional(),
  Tue: DayHoursSchema.nullable().optional(),
  Wed: DayHoursSchema.nullable().optional(),
  Thu: DayHoursSchema.nullable().optional(),
  Fri: DayHoursSchema.nullable().optional(),
  Sat: DayHoursSchema.nullable().optional(),
  Sun: DayHoursSchema.nullable().optional(),
});

const ServiceItemSchema = z.object({
  service_name: z.string(),
  // The on-page category heading, verbatim French (e.g. "PRESTATIONS HOMMES").
  subcategory_name: z.string(),
  // Best-fit Glaura top-level category (one of the 7 fixed names); mapped to a
  // Firestore category_id downstream (see categories.ts).
  category: z.enum(GLAURA_CATEGORY_NAMES),
  // Verbatim French description; may be "" when the page has none.
  service_details: z.string(),
  // 0 for "sur devis" / unknown pricing.
  service_price: z.number(),
  duration_minutes: z.number().nullable(),
});

const ReviewItemSchema = z.object({
  author: z.string(),
  rating: z.number().nullable(),
  text: z.string(),
});

export const SalonExtractSchema = z.object({
  salon: z.object({
    name: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    bio: z.string().nullable(),
    images: z.array(z.string()),
    hours: HoursSchema,
  }),
  services: z.array(ServiceItemSchema),
  // Best-effort; the expander does not reliably capture staff, so this may
  // be an empty array.
  staff: z.array(z.string()),
  reviews: z.array(ReviewItemSchema).nullable().optional(),
});

/**
 * A per-service option ("variant") — for Planity this is a "Finition …" or
 * "Supplément …" row that shares a subcategory with the base service. These
 * are NOT part of the Haiku schema: they're parsed deterministically from the
 * page DOM (see `extractPlanityOptionGraph`) and merged onto the Haiku result
 * in `extractSalon`. Price/duration are the option row's OWN values; the
 * downstream builder combines them with the base service (base price already
 * includes the default finition, e.g. "séchage inclus").
 */
export type ServiceOption = {
  name: string;
  price: number;
  duration_minutes: number | null;
};

/** A Haiku-extracted service, enriched with deterministic options + page order. */
export type ExtractedService = z.infer<typeof ServiceItemSchema> & {
  /** Section-shared options attached to this base service (may be absent/empty). */
  options?: ServiceOption[];
  /** 0-based index of this service's subcategory on the page (for stable ordering). */
  subcategory_order?: number;
};

/** The Haiku output, with services widened to carry deterministic options + order. */
export type SalonExtract = Omit<z.infer<typeof SalonExtractSchema>, "services"> & {
  services: ExtractedService[];
};
export type DayKey = (typeof DAY_KEYS)[number];

// ---------------------------------------------------------------------------
// Trimming — shared intermediate shape
// ---------------------------------------------------------------------------

const MAX_IMAGES = 24;
const MAX_REVIEWS = 20;

type TrimmedService = {
  name: string;
  category: string;
  duration: string;
  price: string;
  description: string;
};

type TrimmedReview = {
  author: string;
  rating: number | null;
  text: string;
};

type TrimmedSalonData = {
  name: string;
  address: string | null;
  phone: string | null;
  bio: string | null;
  images: string[];
  hoursLines: string[];
  services: TrimmedService[];
  staff: string[];
  reviews: TrimmedReview[];
};

function safeJsonParse<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Shared by Planity and Treatwell — both use the schema.org PostalAddress shape. */
function formatPostalAddress(address: unknown): string | null {
  if (!address || typeof address !== "object") return null;
  const a = address as Record<string, unknown>;
  const parts = [a.streetAddress, a.postalCode, a.addressLocality].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

function findTelHref($: CheerioAPI): string | null {
  const href = $('a[href^="tel:"]').first().attr("href");
  return href ? href.replace(/^tel:/, "").trim() : null;
}

function groupServicesByCategory(services: readonly TrimmedService[]): Array<[string, TrimmedService[]]> {
  const grouped = services.reduce<Record<string, TrimmedService[]>>((acc, svc) => {
    const key = svc.category || "";
    return { ...acc, [key]: [...(acc[key] ?? []), svc] };
  }, {});
  return Object.entries(grouped);
}

function renderTrimmedText(data: TrimmedSalonData, sourceType: SourceType): string {
  const lines: string[] = [
    `SOURCE: ${sourceType}`,
    `SALON NAME: ${data.name || "(unknown)"}`,
    `ADDRESS: ${data.address ?? "(unknown)"}`,
    `PHONE: ${data.phone ?? "(unknown)"}`,
    `BIO: ${data.bio ?? "(none)"}`,
    "",
    "HOURS:",
    ...(data.hoursLines.length > 0 ? data.hoursLines.map((l) => `- ${l}`) : ["- (not found)"]),
    "",
    "IMAGES:",
    ...(data.images.length > 0 ? data.images.map((u) => `- ${u}`) : ["- (none found)"]),
    "",
    "SERVICES:",
  ];

  const byCategory = groupServicesByCategory(data.services);
  if (byCategory.length === 0) {
    lines.push("(no services found)");
  } else {
    for (const [category, items] of byCategory) {
      lines.push(`## ${category || "(uncategorized)"}`);
      for (const item of items) {
        const desc = item.description ? ` | ${item.description}` : "";
        lines.push(`- ${item.name} | duration: ${item.duration || "?"} | price: ${item.price || "?"}${desc}`);
      }
    }
  }

  lines.push("", "STAFF:");
  lines.push(...(data.staff.length > 0 ? data.staff.map((s) => `- ${s}`) : ["- (none found)"]));

  if (data.reviews.length > 0) {
    lines.push("", "REVIEWS:");
    for (const r of data.reviews) {
      lines.push(`- ${r.author} | rating: ${r.rating ?? "?"} | ${r.text}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Planity
// ---------------------------------------------------------------------------

function extractPlanityLdJson($: CheerioAPI): Record<string, unknown> | null {
  return safeJsonParse<Record<string, unknown>>($('script[type="application/ld+json"]').first().html());
}

// --- Planity option / variant detection (deterministic, no LLM) ------------

function normKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * True when a Planity row is a shared option/add-on ("Finition Silk Press",
 * "Supplément cheveux longs") rather than a standalone bookable service. On
 * Planity these cannot be booked alone — they attach to the base services in
 * their subcategory.
 */
function isPlanityOptionName(name: string): boolean {
  const n = normKey(name);
  return n.startsWith("finition") || n.startsWith("supplement");
}

/** Diagnostics / pre-consultations never take a finition option. */
function isNonOptionableBase(name: string): boolean {
  return normKey(name).startsWith("diagnostic");
}

/** "190 €" → 190; "de 70 € à 120 €" → 70; "Sur devis" / "" → 0. */
function parsePlanityPrice(raw: string): number {
  const m = raw.replace(/ /g, " ").match(/(\d+(?:[.,]\d+)?)/);
  return m ? Math.round(Number(m[1].replace(",", "."))) : 0;
}

/** "1h30" → 90, "1h" → 60, "45min" → 45, range → first value, else null. */
function parsePlanityDuration(raw: string): number | null {
  const first = (raw.split(/[-–]/)[0] ?? "").trim();
  const hm = first.match(/(\d+)\s*h\s*(\d+)?/i);
  if (hm) return Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0);
  const min = first.match(/(\d+)\s*min/i);
  if (min) return Number(min[1]);
  const bare = first.match(/^(\d+)$/);
  return bare ? Number(bare[1]) : null;
}

export type PlanityOptionGraph = {
  /** key `${normSubcategory}||${normServiceName}` → the base service's options. */
  optionsByService: Map<string, ServiceOption[]>;
  /** `normSubcategory` → 0-based page order index. */
  orderBySubcategory: Map<string, number>;
};

/**
 * Deterministically derives, from the expanded Planity DOM, (a) the page order
 * of each subcategory and (b) the section-shared options ("Finition …" /
 * "Supplément …" rows) attached to each base service in that subcategory.
 * Diagnostics are excluded from receiving options. Sections with no option
 * rows contribute only an order index. Merged onto the Haiku result in
 * `extractSalon` — Haiku itself never sees option rows.
 */
export function extractPlanityOptionGraph($: CheerioAPI): PlanityOptionGraph {
  const optionsByService = new Map<string, ServiceOption[]>();
  const orderBySubcategory = new Map<string, number>();

  $('[id$="-service-item"]').each((sectionIdx, wrapperEl) => {
    const $wrapper = $(wrapperEl);
    const subKey = normKey($wrapper.find("h3").first().text().trim());
    if (subKey && !orderBySubcategory.has(subKey)) orderBySubcategory.set(subKey, sectionIdx);

    const baseNames: string[] = [];
    const options: ServiceOption[] = [];
    $wrapper.find('li[itemtype="https://schema.org/Offer"]').each((_, li) => {
      const $li = $(li);
      const name = $li.find('[id^="service-name-"]').first().text().trim();
      if (!name) return;
      if (isPlanityOptionName(name)) {
        options.push({
          name,
          price: parsePlanityPrice($li.find('[id*="-price"]').first().text().trim()),
          duration_minutes: parsePlanityDuration($li.find('[id*="-duration"]').first().text().trim()),
        });
      } else if (!isNonOptionableBase(name)) {
        baseNames.push(name);
      }
    });

    if (options.length === 0) return;
    for (const baseName of baseNames) {
      optionsByService.set(`${subKey}||${normKey(baseName)}`, options);
    }
  });

  return { optionsByService, orderBySubcategory };
}

function extractPlanityServices($: CheerioAPI): TrimmedService[] {
  const services: TrimmedService[] = [];

  const pushOfferLi = ($li: ReturnType<CheerioAPI>, category: string) => {
    const name = $li.find('[id^="service-name-"]').first().text().trim();
    if (!name) return;
    // Skip "Finition …" / "Supplément …" rows — they are section-shared options
    // folded into their base services' `variants` downstream (see
    // extractPlanityOptionGraph). Emitting them as standalone services is what
    // produced the duplicate "Service already exists" skips on the first run.
    if (isPlanityOptionName(name)) return;
    const duration = $li.find('[id*="-duration"]').first().text().trim();
    const price = $li.find('[id*="-price"]').first().text().trim();
    const description = $li.find('[class*="description"]').first().text().trim();
    services.push({ name, category, duration, price, description });
  };

  const wrappers = $('[id$="-service-item"]');
  if (wrappers.length > 0) {
    wrappers.each((_, wrapperEl) => {
      const $wrapper = $(wrapperEl);
      const category = $wrapper.find("h3").first().text().trim();
      $wrapper.find('li[itemtype="https://schema.org/Offer"]').each((_, li) => {
        pushOfferLi($(li), category);
      });
    });
  } else {
    // Fallback for pages that don't use the "*-service-item" wrapper id
    // convention — category is unknown per offer in this path.
    $('li[itemtype="https://schema.org/Offer"]').each((_, li) => {
      pushOfferLi($(li), "");
    });
  }

  return services;
}

// Generic beauty-service words that mark a Planity "booking calendar" named
// after a service (e.g. "Soin Cils") rather than a real practitioner. Curated
// (NOT derived from the salon's own services — practitioners are often named in
// service titles, which would wrongly filter them out). A name is treated as a
// service calendar only when *every* one of its words is in this set.
const SERVICE_CALENDAR_WORDS = new Set([
  "soin", "soins", "cil", "cils", "ongle", "ongles", "coiffure", "coiffeur",
  "coloration", "coupe", "brushing", "epilation", "epil", "cire", "massage",
  "maquillage", "makeup", "visage", "corps", "spa", "regard", "rehaussement",
  "extension", "extensions", "pose", "depose", "teinture", "sourcil", "sourcils",
  "manucure", "pedicure", "beaute", "institut", "forfait", "prestation", "gel",
  "vernis", "semi", "permanente", "lissage", "balayage", "meche", "meches",
  "chignon", "barbe", "barbier", "hammam", "gommage", "modelage", "nail", "nails",
  "lash", "lashes", "brow", "brows", "microblading", "micropigmentation",
  "peeling", "teint", "french", "capillaire", "defrisage", "tresse", "tresses",
  "tissage", "perruque", "onglerie", "esthetique", "epilations",
  // Booking-slot calendars that aren't a person.
  "rdv", "rendez", "vous", "dispo", "disponibilite", "libre", "reservation",
]);

// French joining words to drop when tokenising a name.
const NAME_STOPWORDS = new Set(["de", "des", "du", "la", "le", "les", "et", "aux", "au"]);

function nameTokens(value: string): string[] {
  return normKey(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t));
}

/** A name is a service-named calendar when every word is a generic beauty term. */
function isServiceCalendar(name: string): boolean {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return true; // no usable name
  return tokens.every((t) => SERVICE_CALENDAR_WORDS.has(t));
}

/** Trim, dedupe, and drop service-named calendars from raw collaborateur names. */
function keepRealStaffNames(rawNames: readonly string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawNames) {
    const name = (raw || "").trim();
    const key = normKey(name);
    if (!name || seen.has(key) || isServiceCalendar(name)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * Real practitioners from Planity's "Collaborateurs" card:
 *   .business_calendars_calendarItem-* > … .business_calendars_text-* = name
 * Deterministic (no LLM); drops service-named calendars (e.g. "Soin Cils").
 */
export function extractPlanityCollaborateurs($: CheerioAPI): string[] {
  const raw: string[] = [];
  $('[class*="business_calendars_calendarItem"]').each((_, el) => {
    raw.push($(el).find('[class*="business_calendars_text"]').first().text());
  });
  return keepRealStaffNames(raw);
}

/**
 * Real practitioners from Treatwell's "Rencontrez l'équipe" section:
 *   .VenueTeamSection… .TeamListItemHeading-module--name-* = name (e.g. "Thiba").
 * Not in the page JSON-LD, so read from the DOM. Deterministic; same filter.
 */
export function extractTreatwellStaff($: CheerioAPI): string[] {
  const raw: string[] = [];
  $('[class*="TeamListItemHeading-module--name"]').each((_, el) => {
    raw.push($(el).text());
  });
  return keepRealStaffNames(raw);
}

function parsePlanity($: CheerioAPI): TrimmedSalonData {
  const ld = extractPlanityLdJson($);

  const name =
    (typeof ld?.name === "string" ? ld.name.trim() : "") ||
    $('[itemtype="https://schema.org/HairSalon"] [itemprop="name"]').first().text().trim() ||
    $("h1").first().text().trim();

  const address = formatPostalAddress(ld?.address);
  const phone = typeof ld?.telephone === "string" ? ld.telephone : findTelHref($);
  const bio = typeof ld?.description === "string" ? ld.description.trim() : null;

  const images = new Set<string>();
  const ldImage = ld?.image;
  if (typeof ldImage === "string") images.add(ldImage);
  if (Array.isArray(ldImage)) {
    for (const url of ldImage) if (typeof url === "string") images.add(url);
  }
  $("[itemprop='image']").each((_, el) => {
    const content = $(el).attr("content");
    if (content) images.add(content);
  });
  $('img[src*="cloudinary.com/planity"]').each((_, el) => {
    const src = $(el).attr("src");
    if (src) images.add(src);
  });

  const hoursLines: string[] = [];
  $('[class*="opening_hours-module_row"]').each((_, el) => {
    const $row = $(el);
    const day = $row.find('[class*="opening_hours-module_day"]').first().text().trim();
    const time = $row.find('[class*="opening_hours-module_time"]').first().text().trim();
    if (day) hoursLines.push(`${day}: ${time || "?"}`);
  });

  const reviewsRaw = Array.isArray(ld?.review) ? ld.review : [];
  const reviews: TrimmedReview[] = reviewsRaw.slice(0, MAX_REVIEWS).map((r): TrimmedReview => {
    const review = r as Record<string, unknown>;
    const author = review.author as Record<string, unknown> | undefined;
    const reviewRating = review.reviewRating as Record<string, unknown> | undefined;
    return {
      author: typeof author?.name === "string" ? author.name : "Anonyme",
      rating: typeof reviewRating?.ratingValue === "number" ? reviewRating.ratingValue : null,
      text: typeof review.reviewBody === "string" ? review.reviewBody.trim() : "",
    };
  });

  const services = extractPlanityServices($);

  return {
    name,
    address,
    phone,
    bio,
    images: Array.from(images).slice(0, MAX_IMAGES),
    hoursLines,
    services,
    // Real practitioners from the Collaborateurs card (service-named calendars
    // filtered out). The authoritative value is re-derived in mergePlanityOptions.
    staff: extractPlanityCollaborateurs($),
    reviews,
  };
}

// ---------------------------------------------------------------------------
// Treatwell
// ---------------------------------------------------------------------------

function extractTreatwellBusiness($: CheerioAPI): Record<string, unknown> | null {
  const ld = safeJsonParse<{ "@graph"?: unknown[] }>($('script[type="application/ld+json"]').first().html());
  const graph = ld?.["@graph"];
  if (!Array.isArray(graph)) return null;
  const business = graph.find(
    (node) => typeof node === "object" && node !== null && (node as Record<string, unknown>)["@type"] === "HealthAndBeautyBusiness",
  );
  return (business as Record<string, unknown> | undefined) ?? null;
}

/** "PT30M" -> "30min", "PT1H" -> "1h", "PT1H30M" -> "1h30", "" on no match. */
function isoDurationToText(iso: string): string {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(iso.trim());
  if (!match) return "";
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = match[2] ? Number(match[2]) : 0;
  if (hours && minutes) return `${hours}h${minutes}`;
  if (hours) return `${hours}h`;
  if (minutes) return `${minutes}min`;
  return "";
}

/** Handles both a single ISO 8601 duration and a "PT55M - PT1H" range. */
function formatIsoDuration(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const parts = value.split("-").map((p) => isoDurationToText(p.trim())).filter(Boolean);
  return parts.join(" - ");
}

function formatTreatwellPrice(offer: Record<string, unknown>): string {
  if (typeof offer.price === "string" || typeof offer.price === "number") {
    return `${offer.price} €`;
  }
  if (offer.lowPrice != null && offer.highPrice != null) {
    return `de ${offer.lowPrice} € à ${offer.highPrice} €`;
  }
  return "Sur devis";
}

function extractTreatwellServices(business: Record<string, unknown> | null): TrimmedService[] {
  const services: TrimmedService[] = [];
  const catalog = business?.hasOfferCatalog as Record<string, unknown> | undefined;
  const categories = catalog?.itemListElement;
  if (!Array.isArray(categories)) return services;

  for (const cat of categories) {
    const category = cat as Record<string, unknown>;
    const categoryName = typeof category.name === "string" ? category.name.trim() : "";
    const offers = category.itemListElement;
    if (!Array.isArray(offers)) continue;

    for (const offerRaw of offers) {
      const offer = offerRaw as Record<string, unknown>;
      const itemOffered = offer.itemOffered as Record<string, unknown> | undefined;
      const name = typeof itemOffered?.name === "string" ? itemOffered.name.trim() : "";
      if (!name) continue;
      const description = typeof itemOffered?.description === "string" ? itemOffered.description.trim() : "";
      const additionalProperty = itemOffered?.additionalProperty as Record<string, unknown> | undefined;
      const duration = formatIsoDuration(additionalProperty?.value);
      const price = formatTreatwellPrice(offer);
      services.push({ name, category: categoryName, duration, price, description });
    }
  }

  return services;
}

function extractTreatwellHours(business: Record<string, unknown> | null): string[] {
  const raw = business?.openingHoursSpecification;
  const specs = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const lines: string[] = [];

  for (const specRaw of specs) {
    const spec = specRaw as Record<string, unknown>;
    const dayOfWeek = spec.dayOfWeek;
    const days = Array.isArray(dayOfWeek) ? dayOfWeek : dayOfWeek ? [dayOfWeek] : [];
    const opens = typeof spec.opens === "string" ? spec.opens : "?";
    const closes = typeof spec.closes === "string" ? spec.closes : "?";
    for (const day of days) {
      if (typeof day === "string") lines.push(`${day}: ${opens} - ${closes}`);
    }
  }

  return lines;
}

function parseTreatwell($: CheerioAPI): TrimmedSalonData {
  const business = extractTreatwellBusiness($);

  const name =
    (typeof business?.name === "string" ? business.name.trim() : "") || $("h1").first().text().trim();
  const address = formatPostalAddress(business?.address);
  const phone = typeof business?.telephone === "string" ? business.telephone : findTelHref($);
  const bio = typeof business?.description === "string" ? business.description.trim() : null;

  const images = new Set<string>();
  const ldImages = business?.image;
  if (Array.isArray(ldImages)) {
    for (const url of ldImages) if (typeof url === "string") images.add(url);
  } else if (typeof ldImages === "string") {
    images.add(ldImages);
  }

  const reviewsRaw = Array.isArray(business?.review) ? business.review : [];
  const reviews: TrimmedReview[] = reviewsRaw.slice(0, MAX_REVIEWS).map((r): TrimmedReview => {
    const review = r as Record<string, unknown>;
    const author = review.author as Record<string, unknown> | undefined;
    const reviewRating = review.reviewRating as Record<string, unknown> | undefined;
    return {
      author: typeof author?.name === "string" ? author.name : "Client",
      rating: typeof reviewRating?.ratingValue === "number" ? reviewRating.ratingValue : null,
      text: typeof review.reviewBody === "string" ? review.reviewBody.trim() : "",
    };
  });

  return {
    name,
    address,
    phone,
    bio,
    images: Array.from(images).slice(0, MAX_IMAGES),
    hoursLines: extractTreatwellHours(business),
    services: extractTreatwellServices(business),
    // Real practitioners from the "Rencontrez l'équipe" DOM section (not in JSON-LD).
    staff: extractTreatwellStaff($),
    reviews,
  };
}

// ---------------------------------------------------------------------------
// Generic fallback (acuity / unrecognized sources — out of scope for P2, but
// keeps trimHtmlForExtraction total over SourceType).
// ---------------------------------------------------------------------------

function parseGeneric($: CheerioAPI): TrimmedSalonData {
  const images = new Set<string>();
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) images.add(src);
  });

  return {
    name: $("h1").first().text().trim(),
    address: null,
    phone: findTelHref($),
    bio: null,
    images: Array.from(images).slice(0, MAX_IMAGES),
    hoursLines: [],
    services: [],
    staff: [],
    reviews: [],
  };
}

// ---------------------------------------------------------------------------
// Acuity (*.as.me / acuityscheduling.com)
// ---------------------------------------------------------------------------

// Acuity ships its whole catalogue as an inline `"appointmentTypes"` JSON blob
// in the page HTML (plain-fetchable — read from the raw html, not the cheerio
// tree, whose scripts are stripped by trimHtmlForExtraction). Services and
// gallery images are deterministic; the salon NAME and HOURS are NOT on the
// page (name comes from the CRM salon, hours live in an on-page image), so we
// leave name empty (create-account falls back to the CRM hint) and hours blank.

type AcuityAppointmentType = {
  name?: string;
  price?: string | number;
  duration?: string | number;
  description?: string;
  active?: boolean;
};

/** Balanced-brace slice from `startBrace`, string-content aware. */
function sliceBalancedObject(str: string, startBrace: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = startBrace; k < str.length; k += 1) {
    const c = str[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return str.slice(startBrace, k + 1);
    }
  }
  return null;
}

/** Parse the inline `"appointmentTypes"` JSON object from raw Acuity HTML. */
function parseAcuityAppointmentTypes(html: string): Record<string, AcuityAppointmentType[]> {
  const keyAt = html.indexOf('"appointmentTypes"');
  if (keyAt < 0) return {};
  const objStart = html.indexOf("{", keyAt);
  const slice = objStart < 0 ? null : sliceBalancedObject(html, objStart);
  return slice ? safeJsonParse<Record<string, AcuityAppointmentType[]>>(slice) ?? {} : {};
}

/** Acuity salon photos: CDN uploads embedded in the page (prefer JPEG over PNG). */
function scrapeAcuityImages(html: string): string[] {
  const unescaped = html.replace(/\\\//g, "/");
  const urls = [
    ...unescaped.matchAll(/https:\/\/cdn-s\.acuityscheduling\.com\/upload-[A-Za-z0-9]+\.(?:jpe?g|png)/gi),
  ].map((m) => m[0]);
  const deduped = [...new Set(urls)];
  const jpegs = deduped.filter((u) => /\.jpe?g$/i.test(u));
  return (jpegs.length > 0 ? jpegs : deduped).slice(0, MAX_IMAGES);
}

/** Deterministic Acuity trim: services + images from the inline JSON. */
function parseAcuity(html: string): TrimmedSalonData {
  const grouped = parseAcuityAppointmentTypes(html);
  const services: TrimmedService[] = [];
  for (const [subcategory, items] of Object.entries(grouped)) {
    if (!Array.isArray(items)) continue;
    for (const t of items) {
      const svcName = typeof t.name === "string" ? t.name.trim() : "";
      if (!svcName || t.active === false) continue;
      const durationMin = Number(t.duration);
      const priceNum = Number(t.price);
      services.push({
        name: svcName,
        category: subcategory.trim(),
        duration: Number.isFinite(durationMin) && durationMin > 0 ? `${durationMin}min` : "",
        price: Number.isFinite(priceNum) && priceNum > 0 ? `${priceNum} €` : "",
        description: typeof t.description === "string" ? t.description.trim() : "",
      });
    }
  }
  return {
    name: "", // not on the page — create-account falls back to the CRM salon name
    address: null,
    phone: null,
    bio: null,
    images: scrapeAcuityImages(html),
    hoursLines: [], // Acuity salons put hours in an on-page image, not the DOM
    services,
    staff: [],
    reviews: [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reduces the fully-expanded page HTML (~1.4-1.9MB) to a compact plain-text
 * block containing only what's needed for extraction: salon name, address,
 * phone, opening hours, the full service list (name/duration/price/
 * description per service), and image URLs. Deterministic, no LLM call.
 */
export function trimHtmlForExtraction(html: string, sourceType: SourceType): string {
  const $ = cheerio.load(html);
  // Keep JSON-LD (read by the parsers above) but drop everything else that
  // never contributes text we extract from.
  $("script:not([type='application/ld+json'])").remove();
  $("style, noscript, svg, nav, link, iframe").remove();

  const data =
    sourceType === "planity"
      ? parsePlanity($)
      : sourceType === "treatwell"
        ? parseTreatwell($)
        : sourceType === "acuity"
          ? parseAcuity(html)
          : parseGeneric($);

  return renderTrimmedText(data, sourceType);
}

const EXTRACTION_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 16000;

const SYSTEM_PROMPT = `You are a precise data-extraction engine for a beauty-salon booking-page onboarding pipeline.

You will be given a compact, mechanically-trimmed text summary of a salon's booking page (Planity or Treatwell). Extract EXACTLY what is present in the text — never invent, guess, or embellish data.

Rules:
- NEVER translate service names or descriptions. Keep the exact original French text verbatim, including spacing, punctuation and accents.
- subcategory_name is the on-page category heading exactly as given (verbatim French), e.g. "PRESTATIONS HOMMES".
- category: classify each service into EXACTLY ONE of these 7 Glaura categories, returning the name verbatim: "Beauté visage", "Epilation", "Bien Etre", "Nails", "Barber", "Coiffure", "Makeup". Guidance: facials / peeling / microneedling / anti-âge / soin du regard -> "Beauté visage"; body treatments / contouring / massage / spa / sauna / mariage packs / institute "prestations homme" (NOT barber) -> "Bien Etre"; épilation / cire -> "Epilation"; onglerie / manucure / pédicure / mains / pieds -> "Nails"; coupe / brushing / coloration / coiffure -> "Coiffure"; barbershop cuts, taille de barbe -> "Barber"; maquillage -> "Makeup". If ambiguous, pick the closest fit.
- Price parsing: "29 €" -> 29. "Sur devis" or no price given -> 0. A range "de 70 € à 120 €" -> 70 (the lower bound).
- Duration parsing: "45min" -> 45. "1h" -> 60. "1h30" / "1h 30min" -> 90. "2h10" / "2h 10min" -> 130. A range "de 55min à 1h" or "55min - 60min" -> use the lower/first value. If duration is truly unknown, return null.
- Hours are given as lines like "Lundi: 10:00 - 19:00" or "Lundi: Fermé" (French) or "Monday: 10:00 - 20:00" (English). Map each to the hours object's Mon..Sun keys using 24h "HH:MM" times, e.g. { "open": "10:00", "close": "19:00" }, or the literal string "closed" for closed days. Omit a day entirely from the hours object if it is not mentioned at all.
- images: copy the listed CDN image URLs exactly as given.
- staff: best-effort only, names only. If no staff names are present in the text, return an empty array — do not invent names.
- If a field is unknown, return null for it (not an empty string) — except service_details, which may be "" and staff/images/services, which may be an empty array.
- Do not include Instagram links or any social-media data anywhere in the output.
- SKIP entirely (do not output as services): "Carte cadeau" / gift cards, "coaching" / "RDV diagnostic" / "suivi contrôle" consultations, "Devenir modèle" promos, "Choisir à l'institut" placeholders, and packs priced "Sur devis".`;

/**
 * Optional extra free-form context appended to the extraction prompt (e.g. a
 * known salon name to disambiguate, or manual corrections from a prior pass).
 */
export type ExtractSalonHints = string;

/**
 * Trims the given HTML, sends it to claude-haiku-4-5 with a structured-
 * output schema, and returns the parsed, validated salon data.
 */
export async function extractSalon(
  html: string,
  sourceType: SourceType,
  url: string,
  hints?: ExtractSalonHints,
): Promise<SalonExtract> {
  const trimmed = trimHtmlForExtraction(html, sourceType);
  const client = new Anthropic();

  const promptLines = [
    `Source: ${sourceType}`,
    `Page URL: ${url}`,
    hints ? `Additional context: ${hints}` : null,
    "",
    "Extract the salon data from the following page content:",
    "",
    trimmed,
  ];
  const userPrompt = promptLines.filter((line): line is string => line !== null).join("\n");

  const response = await client.messages.parse({
    model: EXTRACTION_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(SalonExtractSchema) },
    messages: [{ role: "user", content: userPrompt }],
  });

  if (!response.parsed_output) {
    throw new Error("claude-haiku-4-5 structured-output extraction returned no parsed_output");
  }

  const parsed = response.parsed_output as SalonExtract;
  return sourceType === "planity" ? mergePlanityOptions(parsed, html) : parsed;
}

/**
 * Attaches the deterministic Planity option graph (options + subcategory page
 * order) onto the Haiku-extracted services, matching by
 * (subcategory_name, service_name). Haiku keeps names verbatim, so an exact
 * normalized match is reliable; services with no match are returned unchanged.
 */
function mergePlanityOptions(parsed: SalonExtract, html: string): SalonExtract {
  const $ = cheerio.load(html);
  const { optionsByService, orderBySubcategory } = extractPlanityOptionGraph($);

  const services: ExtractedService[] = parsed.services.map((service) => {
    const subKey = normKey(service.subcategory_name);
    const options = optionsByService.get(`${subKey}||${normKey(service.service_name)}`);
    const order = orderBySubcategory.get(subKey);
    return {
      ...service,
      ...(options && options.length > 0 ? { options } : {}),
      ...(order != null ? { subcategory_order: order } : {}),
    };
  });

  // Re-derive staff deterministically from the DOM (authoritative over Haiku).
  const staff = extractPlanityCollaborateurs($);

  return { ...parsed, services, staff };
}
