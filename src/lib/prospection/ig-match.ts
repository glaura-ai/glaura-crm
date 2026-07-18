import { normalizeBookingUrl, normalizeName } from "@/lib/prospection/match";

// Cross-validation of an Instagram profile against a scraped salon.
// Pure scoring — no network, unit-testable. A profile is only auto-confirmed
// when objective signals line up (booking link in bio, name + location).

export type IgProfile = {
  username: string;
  fullName: string | null;
  followers: number | null;
  biography: string | null;
  bioLinks: string[]; // external_url + bio_links[].url
  categoryName: string | null;
  isPrivate: boolean;
  businessAddress: string | null; // raw business_address_json
};

export type IgProspectFacts = {
  name: string;
  sourceUrl: string;
  postalCode: string | null;
  city: string | null;
};

export type IgSignal =
  | "lien_resa" // bio links to the salon's own booking page — definitive
  | "meme_plateforme" // bio links to the same booking platform (weak)
  | "nom_exact"
  | "nom_proche"
  | "localisation"
  | "categorie_beaute";

export type ScoredCandidate = {
  username: string;
  fullName: string | null;
  followers: number | null;
  score: number;
  signals: IgSignal[];
};

const BOOKING_HOSTS = ["planity.com", "treatwell.fr", "booksy.com", "fresha.com"];

const BEAUTY_CATEGORY = /coiff|hair|barber|salon|beaut|nail|ongle|spa|esth|institut|makeup|lash|brow|cils|sourcil|manucure|barbier/i;

// Generic salon-name words that don't identify a business \u2014 kept out of the
// name-similarity ratio so "Rosalie Beaut\u00e9 Paris" matches "Rosalie".
const GENERIC_TOKENS = new Set([
  "paris",
  "salon",
  "institut",
  "beaute",
  "coiffure",
  "coiffeur",
  "barber",
  "barbier",
  "nails",
  "nail",
  "ongles",
  "hair",
  "studio",
  "atelier",
  "spa",
  "esthetique",
]);

function nameTokens(name: string): string[] {
  const tokens = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
  const distinctive = tokens.filter((token) => !GENERIC_TOKENS.has(token));
  return distinctive.length > 0 ? distinctive : tokens;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function scoreCandidate(prospect: IgProspectFacts, profile: IgProfile): ScoredCandidate {
  const signals: IgSignal[] = [];
  let score = 0;

  // 1. Booking link in bio — the strongest possible cross-validation.
  const prospectUrl = normalizeBookingUrl(prospect.sourceUrl);
  const normalizedLinks = profile.bioLinks.map((link) => normalizeBookingUrl(link)).filter(Boolean);
  if (prospectUrl && normalizedLinks.some((link) => link === prospectUrl)) {
    signals.push("lien_resa");
    score += 5;
  } else if (profile.bioLinks.some((link) => BOOKING_HOSTS.includes(hostOf(link) ?? ""))) {
    signals.push("meme_plateforme");
    score += 1;
  }

  // 2. Name match (profile name or handle vs salon name).
  const prospectName = normalizeName(prospect.name);
  const profileNames = [profile.fullName ?? "", profile.username].map(normalizeName).filter(Boolean);
  if (prospectName && profileNames.some((n) => n === prospectName)) {
    signals.push("nom_exact");
    score += 2.5;
  } else {
    const tokens = nameTokens(prospect.name);
    const haystack = normalizeName(`${profile.fullName ?? ""} ${profile.username}`);
    const matched = tokens.filter((token) => haystack.includes(token));
    if (tokens.length > 0 && matched.length / tokens.length >= 0.5) {
      signals.push("nom_proche");
      score += 1.5;
    }
  }

  // 3. Location: postal code or city in bio / business address.
  const locationHaystack = `${profile.biography ?? ""} ${profile.businessAddress ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const cityNorm = prospect.city
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    (prospect.postalCode && locationHaystack.includes(prospect.postalCode)) ||
    (cityNorm && cityNorm !== "paris" && locationHaystack.includes(cityNorm)) ||
    (cityNorm === "paris" && /paris/.test(locationHaystack))
  ) {
    signals.push("localisation");
    score += 1.5;
  }

  // 4. Beauty business category.
  if (profile.categoryName && BEAUTY_CATEGORY.test(profile.categoryName)) {
    signals.push("categorie_beaute");
    score += 0.5;
  }

  return {
    username: profile.username,
    fullName: profile.fullName,
    followers: profile.followers,
    score,
    signals,
  };
}

export type IgDecision =
  | { status: "CONFIRME"; best: ScoredCandidate; candidates: ScoredCandidate[] }
  | { status: "A_VALIDER"; candidates: ScoredCandidate[] }
  | { status: "INTROUVABLE"; candidates: ScoredCandidate[] };

const CONFIRM_SCORE = 4; // e.g. nom_exact (2.5) + localisation (1.5)
const CANDIDATE_SCORE = 2;

export function decide(scored: ScoredCandidate[]): IgDecision {
  const candidates = [...scored].sort((a, b) => b.score - a.score).slice(0, 3);
  const best = candidates[0];
  if (best && (best.signals.includes("lien_resa") || best.score >= CONFIRM_SCORE)) {
    return { status: "CONFIRME", best, candidates };
  }
  if (best && best.score >= CANDIDATE_SCORE) {
    return { status: "A_VALIDER", candidates: candidates.filter((c) => c.score >= CANDIDATE_SCORE) };
  }
  return { status: "INTROUVABLE", candidates: [] };
}

// Cheap prefilter on topsearch results before spending a profile fetch:
// keep handles sharing at least one name token with the salon.
export function looksRelated(salonName: string, username: string, fullName: string | null): boolean {
  const tokens = nameTokens(salonName);
  if (tokens.length === 0) return true;
  const haystack = normalizeName(`${fullName ?? ""} ${username}`);
  return tokens.some((token) => haystack.includes(token));
}

function slugTokens(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019`]/g, "") // "Legend's" \u2192 "legends", not "legend" + "s"
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

// Trailing tokens that are location/qualifier noise, not part of the brand
// handle: "Brand - Barbershop", "Brand Academy", "Brand Paris 01".
const TRAILING_NOISE = new Set([
  ...GENERIC_TOKENS,
  "barbershop",
  "shop",
  "academy",
  "by",
  "chez",
  "le",
  "la",
  "les",
  "du",
  "de",
  "des",
]);

function brandTokens(tokens: string[]): string[] {
  let end = tokens.length;
  while (end > 1 && (TRAILING_NOISE.has(tokens[end - 1]) || /^\d+$/.test(tokens[end - 1]))) end--;
  return tokens.slice(0, end);
}

// Guess plausible IG handles for a salon, best-first. Business Discovery (and
// the cookie fallback) probes each until one resolves; cross-validation then
// filters out same-name businesses elsewhere. Handles the common directory
// naming "Brand - Location/Chain qualifier" by also trying the brand alone.
export function candidateUsernames(name: string, city: string | null): string[] {
  // Cut the chain/location qualifier after the first separator.
  const core = name.split(/\s[-\u2013|]\s|,/)[0];
  const citySuffix = (city ?? "paris")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  const guesses: string[] = [];
  // Try the trimmed brand first (highest hit rate), then the full name.
  for (const base of [core, name]) {
    const tokens = slugTokens(base);
    if (tokens.length === 0) continue;
    for (const group of [brandTokens(tokens), tokens]) {
      if (group.length === 0) continue;
      const joined = group.join("");
      guesses.push(joined, `${joined}${citySuffix}`, group.join("_"), group.join("."), `${joined}_${citySuffix}`);
    }
  }
  // IG usernames are capped at 30 chars — longer guesses can't exist.
  return [...new Set(guesses)].filter((guess) => guess.length >= 3 && guess.length <= 30);
}
