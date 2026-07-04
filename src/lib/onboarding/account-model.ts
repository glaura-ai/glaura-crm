/**
 * PURE, deterministic transforms for salon-account creation (Step P3a of the
 * onboarding pipeline). No Firebase, no network, no filesystem — everything
 * here is a plain function of its inputs so it can be unit-tested without
 * mocks. The actual Firestore/Auth writes happen in P3b.
 *
 * Field shapes are ported verbatim from
 * `goglow-firebase/functions/createServiceProvider.js` (base userProfile
 * shape, base-slug generation, searchNameList keyword algorithm) plus the
 * CRM headless-onboarding overrides documented in
 * `onboarding/.claude/commands/onboard-headless.md` §2/§7/§8 (disabled
 * invariant, spLocation shape, timing/days).
 */

import { randomBytes } from "node:crypto";
import type { SalonExtract } from "./extract";
import { categoryIdForName } from "./categories";
import type { Timing } from "./hours";

// ---------------------------------------------------------------------------
// slugify — ported from createServiceProvider.js's generateBaseUsername
// ---------------------------------------------------------------------------

/**
 * Base-slug generator for `companyUserName`. Ported verbatim (same
 * operation order) from createServiceProvider.js's `generateBaseUsername` —
 * do not reorder the NFD-normalize/accent-strip steps, it's what keeps slugs
 * matching the live Firestore data. The suffix loop (base, base-1, base-2…)
 * that resolves collisions against existing `companyUserName`s is P3b's
 * job (it needs live Firestore reads); this function only produces the base.
 */
export function slugify(businessName: string): string {
  if (!businessName || typeof businessName !== "string") return "";

  const normalized = businessName
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  const slug = normalized
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "service-provider";
}

// ---------------------------------------------------------------------------
// generatePassword
// ---------------------------------------------------------------------------

/** Random 10-char hex password, matching the onboarding scripts' generator. */
export function generatePassword(): string {
  return randomBytes(5).toString("hex");
}

// ---------------------------------------------------------------------------
// buildSearchNameList — ported from goglow-firebase/functions/utils/keywordUtils.js
// ---------------------------------------------------------------------------

/**
 * Extracts unique search keywords from one or more strings. Ported verbatim
 * from `extractKeywords` in keywordUtils.js: NFD-normalize + strip accents,
 * then collect (1) prefixes of the whole string, (2) prefixes of each
 * whitespace/punctuation-delimited word ≥2 chars, and (3) prefixes of every
 * suffix-word-sequence (so typing "D Paris" finds "Studio D Paris"). Must
 * match createServiceProvider.js's `searchNameList` output byte-for-byte
 * given the same input strings.
 */
export function buildSearchNameList(...strings: Array<string | null | undefined>): string[] {
  const keywords = new Set<string>();

  for (const str of strings) {
    if (!str || typeof str !== "string") continue;

    const normalizedStr = str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 1. Prefixes for the whole string.
    for (let i = 1; i <= normalizedStr.length; i++) {
      keywords.add(normalizedStr.substring(0, i));
    }

    // 2. Per-word prefixes split on spaces / special chars.
    const words = normalizedStr.split(/[\s\-_/().,]+/);
    for (const word of words) {
      if (word.length >= 2) {
        for (let i = 1; i <= word.length; i++) {
          keywords.add(word.substring(0, i));
        }
      }
    }

    // 3. Suffix-sequence prefixes so typing "D Paris" finds "Studio D Paris".
    const parts = normalizedStr.split(/([\s\-_/().,]+)/); // keep delimiters
    for (let i = 2; i < parts.length; i += 2) {
      const suffix = parts.slice(i).join("");
      if (suffix.length > 0) {
        for (let j = 1; j <= suffix.length; j++) {
          keywords.add(suffix.substring(0, j));
        }
      }
    }
  }

  return Array.from(keywords).sort();
}

// ---------------------------------------------------------------------------
// buildSpLocation
// ---------------------------------------------------------------------------

export interface SpLocation {
  formatted_address: string;
  name: string;
  place_id: string;
  geometry: { location: { lat: number; lng: number } };
  latitude: number;
  longitude: number;
}

/**
 * Builds the `spLocation` object shape used by userProfile, per
 * onboard-headless.md §7. Returns `null` when either the address or both
 * coordinates are missing — callers should record a warning in that case.
 */
export function buildSpLocation(
  address: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
): SpLocation | null {
  if (!address || typeof lat !== "number" || typeof lng !== "number") return null;

  return {
    formatted_address: address,
    name: address,
    place_id: "",
    geometry: { location: { lat, lng } },
    latitude: lat,
    longitude: lng,
  };
}

// ---------------------------------------------------------------------------
// buildUserProfile
// ---------------------------------------------------------------------------

/** CRM-supplied hints relevant to account creation (see onboard-headless.md §2/§3). */
export interface AccountHints {
  crmSalonId?: string | null;
}

export interface BuildUserProfileContext {
  uid: string;
  email: string;
  companyUserName: string;
  timing: Timing;
  days: number[];
  searchNameList: string[];
  lat: number | null;
  lng: number | null;
  hints?: AccountHints | null;
  /** The salon booking-page URL that was onboarded (→ `crmSourceUrl`). */
  crmSourceUrl: string;
  /**
   * Injected clock, so this function stays pure/unit-testable. P3b's actual
   * Firestore write MUST replace `createdAt`/`updatedAt` with
   * `admin.firestore.FieldValue.serverTimestamp()` instead of using this
   * value verbatim — it exists here only as a deterministic stand-in.
   */
  now?: Date;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  companyName: string;
  companyUserName: string;
  phone: string;
  countryCode: string;
  address: string;
  spLocation: SpLocation | null;
  userRole: number;
  initialUserRole: number;
  enable: boolean;
  isActive: boolean;
  available: boolean;
  isSubscribed: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  profileImg: string;
  avg_ratting: number;
  total_review: number;
  platform: string;
  loginType: string;
  salonBio: string;
  salon_images: string;
  days: number[];
  timing: Timing;
  blockedUsers: string[];
  bookmarks: string[];
  favoriteCategories: string[];
  favoriteServiceProviders: string[];
  favoriteServices: string[];
  followers: string[];
  following: string[];
  interests: string[];
  recentlyViewed: string[];
  searchNameList: string[];
  crmSalonId: string | null;
  crmOnboardingMode: "headless";
  crmSourceUrl: string;
}

/**
 * Builds the exact `userProfile` document (minus the Firestore write and
 * server timestamps — see `now` above) for a headless-onboarded salon.
 * Forces the DISABLED invariant (`enable`/`isActive`/`available` all
 * `false`, per onboard-headless.md §2) regardless of what a live salon
 * profile would normally have, and stamps the CRM trace fields
 * (`crmSalonId`, `crmOnboardingMode`, `crmSourceUrl`).
 */
export function buildUserProfile(extract: SalonExtract, ctx: BuildUserProfileContext): UserProfile {
  const now = ctx.now ?? new Date();

  return {
    id: ctx.uid,
    email: ctx.email,
    name: extract.salon.name,
    companyName: extract.salon.name,
    companyUserName: ctx.companyUserName,
    phone: extract.salon.phone ?? "",
    countryCode: "+33",
    address: extract.salon.address ?? "",
    spLocation: buildSpLocation(extract.salon.address, ctx.lat, ctx.lng),
    userRole: 2,
    initialUserRole: 2,
    // DISABLED invariant — a teammate flips these live later; never true here.
    enable: false,
    isActive: false,
    available: false,
    isSubscribed: true,
    isDeleted: false,
    // NOTE: P3b must overwrite these with
    // admin.firestore.FieldValue.serverTimestamp() at write time.
    createdAt: now,
    updatedAt: now,
    profileImg: "",
    avg_ratting: 0,
    total_review: 0,
    platform: "web",
    loginType: "email",
    salonBio: extract.salon.bio ?? "",
    // Comma-joined STRING (not an array) — matches the live userProfile shape.
    salon_images: extract.salon.images.join(","),
    days: ctx.days,
    timing: ctx.timing,
    blockedUsers: [],
    bookmarks: [],
    favoriteCategories: [],
    favoriteServiceProviders: [],
    favoriteServices: [],
    followers: [],
    following: [],
    interests: [],
    recentlyViewed: [],
    searchNameList: ctx.searchNameList,
    crmSalonId: ctx.hints?.crmSalonId ?? null,
    crmOnboardingMode: "headless",
    crmSourceUrl: ctx.crmSourceUrl,
  };
}

// ---------------------------------------------------------------------------
// buildServicesPayload
// ---------------------------------------------------------------------------

export interface ServicePayloadItem {
  service_name: string;
  service_details: string;
  service_price: number;
  duration_minutes: number | null;
  subcategory_name: string;
  subcategory_description: string;
  category_id: string;
}

export interface ServicesPayload {
  ownerId: string;
  services: ServicePayloadItem[];
}

/** Builds the `uploadServicesFromJSON` payload shape from the extract's services. */
export function buildServicesPayload(extract: SalonExtract, ownerId: string): ServicesPayload {
  return {
    ownerId,
    services: extract.services.map((service) => ({
      service_name: service.service_name,
      service_details: service.service_details,
      service_price: service.service_price,
      duration_minutes: service.duration_minutes,
      subcategory_name: service.subcategory_name,
      subcategory_description: "",
      category_id: categoryIdForName(service.category),
    })),
  };
}
