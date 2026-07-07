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
   * When true, create the account LIVE (`enable`/`isActive`/`available` = true)
   * instead of the default disabled state. Per-job opt-in (P6 full onboarding).
   */
  enable?: boolean | null;
  /** Booking deposit percentage (0–100) → `spdeposit`/`depositPercentage`. */
  deposit?: number | null;
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
  /** Booking deposit percentage (0–100), read by the app as `depositPercentage ?? deposit ?? spdeposit`. */
  spdeposit: number;
  depositPercentage: number;
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
    // Disabled by default (legacy invariant — a teammate flips it live later),
    // unless the job opted into a LIVE account (P6 full onboarding).
    enable: ctx.enable === true,
    isActive: ctx.enable === true,
    available: ctx.enable === true,
    isSubscribed: true,
    isDeleted: false,
    // NOTE: P3b must overwrite these with
    // admin.firestore.FieldValue.serverTimestamp() at write time.
    createdAt: now,
    updatedAt: now,
    // Main salon picture = first scraped image; gallery = the full list below.
    profileImg: extract.salon.images[0] ?? "",
    avg_ratting: 0,
    total_review: 0,
    platform: "web",
    loginType: "email",
    salonBio: extract.salon.bio ?? "",
    // Comma-joined STRING (not an array) — matches the live userProfile shape.
    salon_images: extract.salon.images.join(","),
    spdeposit: ctx.deposit ?? 0,
    depositPercentage: ctx.deposit ?? 0,
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

/** A single Firestore `variants[]` entry on a service doc (see service_model.dart). */
export interface ServiceVariantDoc {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  salonOnly: boolean;
}

/** The `variants` + `base_option_label` patch applied to a service doc after upload. */
export interface ServiceVariantPatch {
  base_option_label: string;
  variants: ServiceVariantDoc[];
}

export interface ServicesPayloadWithVariants {
  payload: ServicesPayload;
  /** Keyed by normalized `service_name` → the variant patch to apply post-upload. */
  variantsByServiceName: Record<string, ServiceVariantPatch>;
}

/** Firestore `variants` max (service_model.dart). */
const MAX_VARIANTS = 10;

function normServiceKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Builds the `uploadServicesFromJSON` payload plus the per-service `variants`
 * patch to apply afterward. Services are emitted in page order (by
 * `subcategory_order`, then original order) so the upload function's
 * sequential `order` field preserves the website's layout.
 *
 * A service's Planity options ("Finition …" / "Supplément …" rows) become
 * `variants`: the base service's own price already includes the default
 * finition (e.g. "séchage inclus"), so each variant's price/duration is the
 * base PLUS the option row's own supplement. `base_option_label` is set to the
 * base service name so the default option tile renders a real label rather than
 * falling back implicitly (see service_option_resolver.dart).
 */
export function buildServicesPayload(extract: SalonExtract, ownerId: string): ServicesPayloadWithVariants {
  const ordered = extract.services
    .map((service, index) => ({ service, index }))
    .sort((a, b) => {
      const oa = a.service.subcategory_order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.service.subcategory_order ?? Number.MAX_SAFE_INTEGER;
      return oa !== ob ? oa - ob : a.index - b.index;
    });

  const variantsByServiceName: Record<string, ServiceVariantPatch> = {};

  const services: ServicePayloadItem[] = ordered.map(({ service }) => {
    const options = service.options ?? [];
    if (options.length > 0) {
      const basePrice = service.service_price;
      const baseDuration = service.duration_minutes ?? 0;
      const variants: ServiceVariantDoc[] = options.slice(0, MAX_VARIANTS).map((opt, i) => ({
        id: `v_${i + 1}`,
        name: opt.name,
        durationMinutes: baseDuration + (opt.duration_minutes ?? 0),
        price: basePrice + opt.price,
        salonOnly: false,
      }));
      variantsByServiceName[normServiceKey(service.service_name)] = {
        base_option_label: service.service_name,
        variants,
      };
    }

    return {
      service_name: service.service_name,
      service_details: service.service_details,
      service_price: service.service_price,
      duration_minutes: service.duration_minutes,
      subcategory_name: service.subcategory_name,
      subcategory_description: "",
      category_id: categoryIdForName(service.category),
    };
  });

  return { payload: { ownerId, services }, variantsByServiceName };
}

/** Match key for a created service doc → its variant patch (by normalized name). */
export function variantKeyForServiceName(serviceName: string): string {
  return normServiceKey(serviceName);
}

// ---------------------------------------------------------------------------
// buildAgentDocs — synthesized staff (the page carries no real staff data)
// ---------------------------------------------------------------------------

/** A created service, read back after upload, needed to link agents to services. */
export interface CreatedServiceRef {
  id: string;
  category_id: string;
  subcategory_id: string;
}

/** The `createAgent` request body this pipeline sends (see functions/createAgent.js). */
export interface AgentDoc {
  ownerId: string;
  name: string;
  applyToAllDays: boolean;
  days: number[];
  timing: Timing;
  /** categoryId → [subcategoryId] covering every service. */
  categorySubcategories: Record<string, string[]>;
  /** subcategoryId → [serviceId] covering every service. */
  subcategoryServices: Record<string, string[]>;
  assignedProfession: string;
}

/** First-name pool for synthesized agents (no real staff on the source page). */
const AGENT_NAME_POOL = ["Awa", "Fatou", "Naomi", "Sarah", "Léa", "Aïcha", "Mariam", "Chloé"] as const;

/**
 * Builds `count` synthesized agents, each assigned to ALL of the salon's
 * services (the page exposes no real staff). Agents share the salon's
 * `timing`/`days`; the service link lives on the agent doc via
 * `subcategoryServices` / `categorySubcategories`.
 */
export function buildAgentDocs(
  count: number,
  ownerId: string,
  timing: Timing,
  days: number[],
  services: readonly CreatedServiceRef[],
): AgentDoc[] {
  const subcategoryServices = services.reduce<Record<string, string[]>>((acc, svc) => {
    if (!svc.subcategory_id) return acc;
    return { ...acc, [svc.subcategory_id]: [...(acc[svc.subcategory_id] ?? []), svc.id] };
  }, {});

  const categorySubcategories = services.reduce<Record<string, string[]>>((acc, svc) => {
    if (!svc.category_id || !svc.subcategory_id) return acc;
    const existing = acc[svc.category_id] ?? [];
    return existing.includes(svc.subcategory_id)
      ? acc
      : { ...acc, [svc.category_id]: [...existing, svc.subcategory_id] };
  }, {});

  return Array.from({ length: Math.max(0, count) }, (_, i) => ({
    ownerId,
    name: AGENT_NAME_POOL[i % AGENT_NAME_POOL.length],
    applyToAllDays: false,
    days,
    timing,
    categorySubcategories,
    subcategoryServices,
    assignedProfession: "",
  }));
}

// ---------------------------------------------------------------------------
// buildReviewDocs — real Planity reviews first (forced to 5★), then filled
// ---------------------------------------------------------------------------

/** A review doc written to `userProfile/{uid}/reviews` (see review_model.dart). */
export interface ReviewDoc {
  userName: string;
  userImage: string;
  userid: string;
  ratting: number;
  review: string;
  serviceId: string;
  serviceName: string;
  jobId: string;
  /** Plain Date here (pure); P3b converts to a Firestore Timestamp at write time. */
  createdAt: Date;
}

export interface ReviewsResult {
  reviews: ReviewDoc[];
  avg_ratting: number;
  total_review: number;
}

/** Curated French 5★ comments used to top up to the requested review count. */
const FILLER_REVIEW_TEXTS = [
  "Salon au top, équipe à l'écoute et très professionnelle. Je recommande vivement !",
  "Accueil chaleureux et résultat impeccable. Je reviendrai sans hésiter.",
  "Prestation parfaite, on ressort ravie à chaque fois. Merci beaucoup !",
  "Très satisfaite, travail soigné et conseils personnalisés. Un grand bravo.",
  "Une adresse que je recommande les yeux fermés, personnel adorable.",
  "Ponctualité, hygiène et professionnalisme au rendez-vous. Parfait.",
  "Résultat magnifique et ambiance très agréable. Rien à redire.",
  "Excellente expérience du début à la fin, je suis conquise.",
  "Des mains en or et des conseils avisés. Merci pour votre travail.",
  "Toujours un plaisir de venir, service irréprochable à chaque visite.",
  "Salon propre, équipe souriante et prestation de grande qualité.",
  "Je recommande à 100%, on se sent entre de bonnes mains.",
  "Super accueil et finition parfaite, exactement ce que je voulais.",
  "Rapport qualité-prix excellent et résultat au-delà de mes attentes.",
  "Une équipe passionnée et à l'écoute, je ne changerais pour rien au monde.",
] as const;

const FILLER_REVIEW_AUTHORS = [
  "Aminata D.", "Sophie L.", "Nadia B.", "Camille R.", "Yasmine K.", "Laura M.",
  "Inès T.", "Sarah P.", "Awa C.", "Manon G.", "Fatoumata S.", "Julie V.",
  "Chloé N.", "Aïcha F.", "Emma D.", "Kadiatou B.", "Léa H.", "Marine J.",
  "Sabrina O.", "Clara W.", "Mariam K.", "Océane P.", "Rania Z.", "Élodie M.",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Produces exactly `target` five-star reviews: the real scraped reviews first
 * (text preserved, rating forced to 5), topped up from the curated pool to
 * reach `target`. `createdAt` is spread backwards from `now` so the feed reads
 * naturally. Aggregates are `avg_ratting: 5` / `total_review: target`.
 */
export function buildReviewDocs(
  realReviews: ReadonlyArray<{ author?: string | null; text?: string | null }>,
  target: number,
  now: Date,
): ReviewsResult {
  const real = realReviews
    .filter((r) => (r.text ?? "").trim().length > 0)
    .map((r) => ({ author: (r.author ?? "").trim() || "Client", text: (r.text ?? "").trim() }));

  const chosen: Array<{ author: string; text: string }> = [];
  for (let i = 0; i < target; i += 1) {
    if (i < real.length) {
      chosen.push(real[i]);
    } else {
      const f = i - real.length;
      chosen.push({
        author: FILLER_REVIEW_AUTHORS[f % FILLER_REVIEW_AUTHORS.length],
        text: FILLER_REVIEW_TEXTS[f % FILLER_REVIEW_TEXTS.length],
      });
    }
  }

  const reviews: ReviewDoc[] = chosen.map((r, i) => ({
    userName: r.author,
    userImage: "",
    userid: "",
    ratting: 5,
    review: r.text,
    serviceId: "",
    serviceName: "",
    jobId: "",
    createdAt: new Date(now.getTime() - (i * 5 + 2) * DAY_MS),
  }));

  return { reviews, avg_ratting: 5, total_review: reviews.length };
}
