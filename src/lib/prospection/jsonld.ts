import * as cheerio from "cheerio";

// All four directories (Planity, Treatwell, Booksy, Fresha) embed their listing
// pages as schema.org JSON-LD. Two shapes exist in the wild:
//  - ItemList -> itemListElement[].item  (Planity, Treatwell, Booksy)
//  - @graph[] of business nodes         (Fresha)
// This extractor handles both and normalizes to RawBusiness.

export type RawBusiness = {
  name: string;
  url: string | null;
  rating: number | null;
  reviewCount: number | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
};

const BUSINESS_TYPES = new Set([
  "HealthAndBeautyBusiness",
  "HairSalon",
  "BeautySalon",
  "NailSalon",
  "DaySpa",
  "TattooParlor",
  "LocalBusiness",
]);

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeMatches(node: JsonObject): boolean {
  const t = node["@type"];
  if (typeof t === "string") return BUSINESS_TYPES.has(t);
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && BUSINESS_TYPES.has(x));
  return false;
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toBusiness(node: JsonObject): RawBusiness | null {
  const name = asString(node.name);
  if (!name) return null;

  const address = isObject(node.address) ? node.address : {};
  const ratingNode = isObject(node.aggregateRating) ? node.aggregateRating : {};
  const reviewCount = asNumber(ratingNode.reviewCount) ?? asNumber(ratingNode.ratingCount);
  const id = asString(node["@id"]);

  return {
    name,
    url: asString(node.url) ?? (id ? id.split("#")[0] : null),
    rating: asNumber(ratingNode.ratingValue),
    reviewCount: reviewCount == null ? null : Math.round(reviewCount),
    street: asString(address.streetAddress),
    postalCode: asString(address.postalCode),
    city: asString(address.addressLocality),
  };
}

function collectFromNode(node: JsonValue, out: RawBusiness[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectFromNode(item, out);
    return;
  }
  if (!isObject(node)) return;

  if (node["@type"] === "ItemList" && Array.isArray(node.itemListElement)) {
    for (const element of node.itemListElement) {
      const item = isObject(element) && isObject(element.item) ? element.item : element;
      if (isObject(item) && typeMatches(item)) {
        const business = toBusiness(item);
        if (business) out.push(business);
      }
    }
    return;
  }

  if (Array.isArray(node["@graph"])) {
    collectFromNode(node["@graph"], out);
    return;
  }

  if (typeMatches(node)) {
    const business = toBusiness(node);
    if (business) out.push(business);
  }
}

export function extractBusinesses(html: string): RawBusiness[] {
  const $ = cheerio.load(html);
  const out: RawBusiness[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw.trim()) return;
    try {
      collectFromNode(JSON.parse(raw) as JsonValue, out);
    } catch {
      // Malformed JSON-LD block — skip it, other blocks may still parse.
    }
  });
  return out;
}
