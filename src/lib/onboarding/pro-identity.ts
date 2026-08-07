export type ProIdentitySignal =
  | "name_exact"
  | "name_tokens"
  | "name_acronym"
  | "booking_claim_conflict";

export type ProIdentityResult = {
  status: "verified" | "review_required";
  score: number;
  requiredScore: number;
  signals: ProIdentitySignal[];
  bookingClaim: string | null;
};

const REQUIRED_SCORE = 3;

// These words describe thousands of salons and must never be enough to prove
// that an Instagram account belongs to one particular booking page.
const GENERIC_NAME_TOKENS = new Set([
  "and", "atelier", "barber", "barbier", "beaute", "beauty", "by",
  "chez", "coiff", "coiffeur", "coiffure", "de", "des", "du", "esthetique",
  "et", "hair", "institut", "la", "le", "les", "nail", "nails", "ongle",
  "ongles", "paris", "salon", "spa", "studio",
]);

const ACRONYM_IGNORED_TOKENS = new Set([
  "and", "by", "chez", "de", "des", "du", "et", "la", "le", "les",
  "paris", "salon", "studio",
]);

/** Canonical claim shared by URL deduplication and Instagram-link matching. */
export function normalizeBookingClaim(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname
      .replace(/\/{2,}/g, "/")
      .replace(/\/+$/, "")
      .toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/**
 * Decides whether Meta's verified Instagram identity plausibly represents the
 * business extracted from the submitted booking page. This is deliberately a
 * confidence gate rather than strict equality: real brands use abbreviations,
 * city suffixes and punctuation that differ between Instagram and Planity.
 */
export function evaluateProSalonIdentity(input: {
  bookingSalonName: string;
  bookingUrl: string;
  instagramUsername: string;
  instagramDisplayName?: string | null;
}): ProIdentityResult {
  const signals: ProIdentitySignal[] = [];
  let score = 0;
  const bookingClaim = normalizeBookingClaim(input.bookingUrl);

  const bookingNormalized = normalizeName(input.bookingSalonName);
  const instagramIdentity = `${input.instagramDisplayName ?? ""} ${input.instagramUsername}`;
  const instagramNormalized = normalizeName(instagramIdentity);
  if (bookingNormalized && (
    normalizeName(input.instagramDisplayName ?? "") === bookingNormalized ||
    normalizeName(input.instagramUsername) === bookingNormalized
  )) {
    signals.push("name_exact");
    score += 4;
  }

  const bookingTokens = distinctiveTokens(input.bookingSalonName);
  const instagramTokens = new Set(tokens(instagramIdentity));
  const tokenMatches = bookingTokens.filter((token) =>
    instagramTokens.has(token) || (token.length >= 4 && instagramNormalized.includes(token))
  );
  if (bookingTokens.length > 0 && tokenMatches.length / bookingTokens.length >= 0.5) {
    signals.push("name_tokens");
    score += 3;
  }

  const instagramHaystack = new Set(tokens(instagramIdentity));
  const acronyms = brandAcronyms(input.bookingSalonName);
  if (acronyms.some((acronym) => instagramHaystack.has(acronym))) {
    signals.push("name_acronym");
    score += 3;
  }

  return {
    status: score >= REQUIRED_SCORE ? "verified" : "review_required",
    score,
    requiredScore: REQUIRED_SCORE,
    signals: Array.from(new Set(signals)),
    bookingClaim,
  };
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function tokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function distinctiveTokens(value: string): string[] {
  const values = tokens(value).filter((token) => !GENERIC_NAME_TOKENS.has(token));
  return Array.from(new Set(values));
}

function brandAcronyms(value: string): string[] {
  const found: string[] = [...(value.match(/\b[A-ZÀ-ÖØ-Ý]{2,6}\b/g) ?? [])];
  const words = tokens(value).filter((token) => !ACRONYM_IGNORED_TOKENS.has(token));
  if (words.length >= 2) found.push(words.map((word) => word[0]).join(""));
  return Array.from(new Set(found.map(normalizeName).filter((token) => token.length >= 2)));
}
