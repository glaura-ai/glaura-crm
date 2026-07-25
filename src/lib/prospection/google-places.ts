import { normalizeName } from "@/lib/prospection/match";

// Google Business Profile lookup via Places API (New) Text Search.
//
// Used as a ranking signal: a salon with a Google presence is a real, findable
// business. We never exclude a prospect for lacking one.
//
// COST — read before touching FIELD_MASK. Text Search bills at the highest SKU
// any requested field belongs to:
//   Essentials (places.id, places.name)                      unlimited free
//   Pro        (displayName, formattedAddress, businessStatus) 5 000/month free, then $32/1k
//   Enterprise (rating, userRatingCount, websiteUri)           1 000/month free, then $35/1k
// We deliberately stay on Pro: it confirms a profile exists AND returns enough
// to verify we matched the right business, which Essentials cannot. Adding
// `rating` or `userRatingCount` would silently move EVERY lookup to Enterprise
// and start billing the pool (~3 300 prospects) at the top rate. Don't.
// This is why googleRating/googleReviewCount stay unfilled.

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.businessStatus";
const TIMEOUT_MS = 10_000;

export class PlacesAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlacesAuthError";
  }
}

export class PlacesQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlacesQuotaError";
  }
}

export type PlaceMatch = {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  businessStatus: string | null;
};

export function placesApiKey(): string | null {
  return process.env.GOOGLE_PLACES_KEY || null;
}

type SearchTextResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    businessStatus?: string;
  }>;
  error?: { code?: number; status?: string; message?: string };
};

// Minimum overlap between the two normalized names, as a fraction of the longer
// one. Containment alone is too weak: "ongl" is contained in "ongleriedumarais"
// but says nothing. Requiring the common part to be most of the name rejects
// that while still allowing "Baton Rouge" vs "Baton Rouge Paris" (0.67).
const MIN_NAME_OVERLAP = 0.5;
const MIN_NAME_LENGTH = 4;

// Google returns a plausible-looking business for almost any query, so a
// returned place is not yet a match — this is what stops a neighbouring
// business being recorded as the salon's profile.
//
// Deliberately biased toward rejecting: a missed profile only costs a prospect
// some rank (GBP is a ranking signal, never a filter), whereas a wrong one puts
// bad data in front of a rep.
export function isPlausibleMatch(prospectName: string, placeName: string): boolean {
  const a = normalizeName(prospectName);
  const b = normalizeName(placeName);
  if (!a || !b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < MIN_NAME_LENGTH) return shorter === longer;
  if (!longer.includes(shorter)) return false;
  return shorter.length / longer.length >= MIN_NAME_OVERLAP;
}

export function buildQuery(name: string, address: string | null, city: string | null): string {
  return [name, address, city].filter(Boolean).join(", ");
}

/**
 * Finds the Google Business Profile for a salon. Returns null when Google has
 * no result, or when the best result doesn't plausibly correspond to the salon
 * we asked about.
 *
 * Throws PlacesAuthError / PlacesQuotaError for conditions that mean "stop the
 * whole run" rather than "this one prospect has no profile".
 */
export async function findPlace(
  apiKey: string,
  name: string,
  address: string | null,
  city: string | null,
): Promise<PlaceMatch | null> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: buildQuery(name, address, city),
      languageCode: "fr",
      regionCode: "FR",
      maxResultCount: 1,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403) {
    throw new PlacesAuthError(`Places API refuse la clé (HTTP ${response.status}). Vérifie GOOGLE_PLACES_KEY et ses restrictions.`);
  }
  if (response.status === 429) {
    throw new PlacesQuotaError("Places API: quota dépassé (HTTP 429).");
  }
  if (!response.ok) {
    throw new Error(`Places API HTTP ${response.status}`);
  }

  const data = (await response.json()) as SearchTextResponse;
  if (data.error) {
    const status = data.error.status ?? "";
    if (status === "PERMISSION_DENIED" || status === "UNAUTHENTICATED") {
      throw new PlacesAuthError(data.error.message ?? status);
    }
    if (status === "RESOURCE_EXHAUSTED") {
      throw new PlacesQuotaError(data.error.message ?? status);
    }
    throw new Error(data.error.message ?? "Places API error");
  }

  const place = data.places?.[0];
  const placeId = place?.id;
  const placeName = place?.displayName?.text;
  if (!placeId || !placeName) return null;
  if (!isPlausibleMatch(name, placeName)) return null;

  return {
    placeId,
    displayName: placeName,
    formattedAddress: place.formattedAddress ?? "",
    businessStatus: place.businessStatus ?? null,
  };
}
