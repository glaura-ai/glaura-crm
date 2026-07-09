/**
 * Acuity salon onboarder (config-driven CLI).
 *
 * WHY THIS EXISTS: Acuity (`*.as.me` / `acuityscheduling.com`) is NOT a
 * supported pipeline source — `expand.ts`/`extract.ts` have no Acuity path, so
 * the worker would treat it as "generic" and extract zero services. BUT an
 * Acuity scheduling page ships its entire catalogue as inline JSON in the page
 * HTML (a plain `fetch` gets it — no JS/Playwright needed). This script parses
 * that JSON deterministically and feeds it through the existing, battle-tested
 * `createDisabledSalonAccount()` — reusing every downstream write (Auth,
 * userProfile, services upload, agents, reviews, deposit, EU image re-host,
 * geocode) with ZERO changes to the Planity/Treatwell pipeline.
 *
 * Two Acuity fields are NOT machine-readable and must be supplied in the config:
 *   - the business NAME (the page <title> is generic, `businessName` is empty)
 *   - opening HOURS (salons put these in an on-page IMAGE, not the DOM)
 * Everything else (services, prices, durations, descriptions, address, gallery
 * images) is parsed from the page.
 *
 * USAGE:
 *   npx tsx scripts/onboard-acuity.ts <config.json> [--dry]
 *
 * On the VPS (needs the firebase SA key + EU media access):
 *   docker run --rm -u root --network host \
 *     --env-file /opt/glaura/.env.onboard \
 *     -v /opt/glaura/secrets/firebase-adminsdk.json:/opt/glaura/secrets/firebase-adminsdk.json:ro \
 *     -v /opt/glaura/<config>.json:/app/cfg.json:ro \
 *     -v /opt/glaura/onboard-acuity.ts:/app/x.ts:ro \
 *     ghcr.io/glaura-ai/glaura-crm:latest npx tsx x.ts cfg.json
 *
 * CONFIG SHAPE (see AcuityOnboardConfig below). Example:
 *   {
 *     "acuityUrl": "https://excellencestylist.as.me/schedule/3d010218",
 *     "crmSalonId": "cmr97oc5p00016f01owykmnch",
 *     "salonName": "Excellence Stylist",
 *     "address": "440 clos de la Courtine, 93160 Noisy-le-Grand",
 *     "instagram": "excellence.stylist",
 *     "bio": "Spécialiste perruques sur-mesure ...",
 *     "category": "Coiffure",
 *     "hours": { "Mon": "closed", "Wed": { "open": "10:30", "close": "23:59" }, "Sun": { "open": "12:00", "close": "21:00" } },
 *     "overrides": { "loginEmail": "x@glaura.fr", "loginPassword": "Glaura123", "enable": true, "deposit": 30, "agentCount": 1, "reviewTarget": 15 }
 *   }
 */

import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import type { GlauraCategoryName } from "@/lib/onboarding/categories";
import { GLAURA_CATEGORY_NAMES } from "@/lib/onboarding/categories";
import type { ExtractedService, SalonExtract } from "@/lib/onboarding/extract";
import type { OnboardingHints, OnboardingOverrides } from "@/lib/onboarding";

/**
 * One physical venue of a multi-venue Acuity brand. Each venue becomes its own
 * LIVE Glaura salon `userProfile` (bookings/availability are keyed per provider,
 * so a second location MUST be a second account — see the chain notes below).
 * Its service catalogue is the subset of the shared Acuity catalogue whose
 * `calendarIDs` include this venue's `calendarId`.
 */
interface AcuityVenueConfig {
  /** Display name (e.g. "Tatiana.B — Faubourg Saint-Honoré"). Drives companyUserName slug. */
  name: string;
  address: string;
  /** Acuity calendar id (a key's `id` in the page `calendars` map) — filters services to this venue. */
  calendarId: number;
  /** Per-day opening hours (extract HoursSchema shape). Days omitted => closed. */
  hours: SalonExtract["salon"]["hours"];
  instagram?: string;
  bio?: string;
  crmSalonId?: string;
  overrides?: OnboardingOverrides;
}

/**
 * Chain grouping written to Firestore `salonGroups/{slug}` after all venues are
 * created — the exact shape the website's PublicChainLandingService reads
 * (`enabled`, `name`, `description`, `salonOwnerIds[]`). The slug is the chain's
 * public subdomain (e.g. `tatiana-b` → tatiana-b.glaura.ai), independent of each
 * salon's own companyUserName.
 */
interface AcuityChainConfig {
  slug: string;
  name: string;
  description?: string;
  /** Optional reservation policy shown in the chain page's right-hand panel (per-chain). */
  reservationPolicy?: Array<{ title: string; text: string }>;
  reservationPolicyNote?: string;
}

interface AcuityOnboardConfig {
  acuityUrl: string;
  /** Glaura category applied to every service (Acuity categories are freeform). Default "Coiffure". */
  category?: GlauraCategoryName;
  /** Explicit gallery URLs (shared across all venues); when omitted, JPEG images are auto-scraped from the page description. */
  images?: string[];

  // --- Single-venue mode (legacy; used when `venues` is absent) ---
  crmSalonId?: string;
  salonName?: string;
  address?: string;
  instagram?: string;
  bio?: string;
  /** Per-day opening hours (extract HoursSchema shape). Days omitted => closed. */
  hours?: SalonExtract["salon"]["hours"];
  overrides?: OnboardingOverrides;

  // --- Multi-venue chain mode (used when `venues` is present) ---
  /** Two or more physical venues sharing one Acuity catalogue → one live salon each. */
  venues?: AcuityVenueConfig[];
  /** Chain grouping doc written after all venues are created. Required when `venues` is set. */
  chain?: AcuityChainConfig;
}

/** Balanced-brace slice starting at `startBrace`, string-content aware. */
function sliceBalanced(str: string, startBrace: number): string | null {
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

/** Extracts the value of a top-level JSON key (`"key": {...}` or `"key": "..."`) from raw HTML. */
function extractJsonValue(html: string, key: string): string | null {
  const i = html.indexOf(`"${key}"`);
  if (i < 0) return null;
  const objStart = html.indexOf("{", i);
  return objStart < 0 ? null : sliceBalanced(html, objStart);
}

type AcuityType = {
  name: string;
  price: string;
  duration: number;
  description?: string;
  active?: boolean;
  /** Calendars (venues) that offer this type; empty/absent => offered everywhere. */
  calendarIDs?: number[];
};

/**
 * Maps the parsed `appointmentTypes` object into Glaura `ExtractedService`s.
 * When `calendarId` is provided (multi-venue chain mode), only types offered at
 * that venue are kept (a type with no `calendarIDs` is treated as everywhere).
 * `subcategory_order` is the category's index in the FULL page, kept stable
 * across venues so every salon renders subcategories in the same page order.
 */
function buildServices(
  grouped: Record<string, AcuityType[]>,
  category: GlauraCategoryName,
  calendarId?: number,
): ExtractedService[] {
  const services: ExtractedService[] = [];
  Object.entries(grouped).forEach(([subcategory, items], order) => {
    for (const t of items) {
      if (t.active === false) continue;
      if (calendarId != null) {
        const ids = t.calendarIDs ?? [];
        if (ids.length > 0 && !ids.includes(calendarId)) continue;
      }
      services.push({
        service_name: t.name.trim(),
        subcategory_name: subcategory.trim(),
        category,
        service_details: (t.description ?? "").trim(),
        service_price: Number(t.price) || 0,
        duration_minutes: Number(t.duration) || null,
        subcategory_order: order,
      });
    }
  });
  return services;
}

/**
 * Auto-scrapes the salon's own photos: every Acuity CDN upload URL in the page
 * (they live in the owner `description` blob, JSON-escaped as `https:\/\/...`).
 * Prefers JPEG photos over PNG text/banner graphics; de-dupes, preserves order.
 */
function scrapeDescriptionImages(html: string): string[] {
  const unescaped = html.replace(/\\\//g, "/");
  const urls = [...unescaped.matchAll(/https:\/\/cdn-s\.acuityscheduling\.com\/upload-[A-Za-z0-9]+\.(?:jpe?g|png)/gi)].map((m) => m[0]);
  const deduped = [...new Set(urls)];
  const jpegs = deduped.filter((u) => /\.jpe?g$/i.test(u));
  return jpegs.length > 0 ? jpegs : deduped;
}

/** Onboards ONE salon (one venue) and returns the create-account result. */
async function onboardVenue(
  acuityUrl: string,
  extract: SalonExtract,
  hints: OnboardingHints,
  overrides: OnboardingOverrides | undefined,
) {
  // Imported here (not top-level) so env is loaded before firebase-admin initializes.
  const { createDisabledSalonAccount } = await import("@/lib/onboarding/create-account");
  return createDisabledSalonAccount(extract, hints, { url: acuityUrl, sourceType: "acuity" }, overrides);
}

/**
 * Writes the `salonGroups/{slug}` chain doc grouping the created salon uids —
 * the exact fields PublicChainLandingService reads. Uses `merge:true` so a
 * re-run updates the roster without clobbering fields set elsewhere (e.g. an
 * admin-added `adminUserIds`/`featureFlags`).
 */
async function writeChainGroup(chain: AcuityChainConfig, salonOwnerIds: string[]) {
  const { getDb } = await import("@/lib/firebase-admin");
  const doc: Record<string, unknown> = {
    enabled: true,
    name: chain.name,
    description: chain.description ?? "",
    salonOwnerIds,
  };
  if (chain.reservationPolicy && chain.reservationPolicy.length > 0) {
    doc.reservationPolicy = chain.reservationPolicy.map((p) => ({ title: p.title, text: p.text }));
    doc.reservationPolicyNote = chain.reservationPolicyNote ?? "";
  }
  await getDb().collection("salonGroups").doc(chain.slug).set(doc, { merge: true });
}

function logServices(label: string, services: ExtractedService[], imageCount: number) {
  console.log(`\n[${label}] ${services.length} services / ${new Set(services.map((s) => s.subcategory_name)).size} subcategories, ${imageCount} images.`);
  for (const s of services) console.log(`  [${s.subcategory_order}] ${s.subcategory_name} :: ${s.service_name} — ${s.service_price}€ / ${s.duration_minutes}min`);
}

async function main() {
  const cfgPath = process.argv[2];
  const dry = process.argv.includes("--dry");
  if (!cfgPath) throw new Error("usage: onboard-acuity.ts <config.json> [--dry]");

  const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as AcuityOnboardConfig;
  const category: GlauraCategoryName = cfg.category ?? "Coiffure";
  if (!GLAURA_CATEGORY_NAMES.includes(category)) throw new Error(`invalid category "${category}"`);

  const html = await (await fetch(cfg.acuityUrl, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
  const slice = extractJsonValue(html, "appointmentTypes");
  if (!slice) throw new Error("appointmentTypes JSON not found on the Acuity page");
  const grouped = JSON.parse(slice) as Record<string, AcuityType[]>;

  const images = cfg.images ?? scrapeDescriptionImages(html);

  // ----- Multi-venue chain mode -----------------------------------------
  if (cfg.venues && cfg.venues.length > 0) {
    if (!cfg.chain?.slug) throw new Error("`chain.slug` is required when `venues` is set");

    const plans = cfg.venues.map((venue) => {
      const services = buildServices(grouped, category, venue.calendarId);
      if (services.length === 0) throw new Error(`venue "${venue.name}" (calendarId ${venue.calendarId}) matched no active services`);
      const extract: SalonExtract = {
        salon: { name: venue.name, address: venue.address, phone: null, bio: venue.bio ?? null, images, hours: venue.hours },
        services,
        staff: [],
        reviews: [],
      };
      const hints: OnboardingHints = {
        crmSalonId: venue.crmSalonId ?? null,
        salonName: venue.name,
        instagram: venue.instagram ?? null,
        instagramHandle: venue.instagram ?? null,
        address: venue.address,
      };
      return { venue, extract, hints };
    });

    console.log(`CHAIN "${cfg.chain.name}" (slug ${cfg.chain.slug}) — ${plans.length} venues:`);
    for (const p of plans) logServices(p.venue.name, p.extract.services, images.length);
    console.log("\nOverrides per venue:");
    for (const p of plans) console.log(`  ${p.venue.name}: ${JSON.stringify(p.venue.overrides ?? {})}`);

    if (dry) {
      console.log("\n--dry: no writes performed.");
      return;
    }

    const salonOwnerIds: string[] = [];
    for (const p of plans) {
      console.log(`\n=== Onboarding venue: ${p.venue.name} ===`);
      const result = await onboardVenue(cfg.acuityUrl, p.extract, p.hints, p.venue.overrides);
      console.log(JSON.stringify(result, null, 2));
      if (result.status === "failed" || !result.ownerId) {
        throw new Error(`venue "${p.venue.name}" failed to onboard: ${result.error ?? "no ownerId"}`);
      }
      salonOwnerIds.push(result.ownerId);
    }

    console.log(`\n=== Writing chain doc salonGroups/${cfg.chain.slug} with ${salonOwnerIds.length} salons ===`);
    await writeChainGroup(cfg.chain, salonOwnerIds);
    console.log(JSON.stringify({ slug: cfg.chain.slug, name: cfg.chain.name, salonOwnerIds }, null, 2));
    return;
  }

  // ----- Single-venue mode (legacy) -------------------------------------
  if (!cfg.salonName) throw new Error("`salonName` is required in single-venue mode");
  const services = buildServices(grouped, category);
  if (services.length === 0) throw new Error("no active appointment types parsed");

  const extract: SalonExtract = {
    salon: { name: cfg.salonName, address: cfg.address ?? null, phone: null, bio: cfg.bio ?? null, images, hours: cfg.hours ?? {} },
    services,
    staff: [],
    reviews: [],
  };
  const hints: OnboardingHints = {
    crmSalonId: cfg.crmSalonId ?? null,
    salonName: cfg.salonName,
    instagram: cfg.instagram ?? null,
    instagramHandle: cfg.instagram ?? null,
    address: cfg.address ?? null,
  };

  logServices(cfg.salonName, services, images.length);
  console.log("Overrides:", JSON.stringify(cfg.overrides ?? {}));

  if (dry) {
    console.log("\n--dry: no writes performed.");
    return;
  }

  const result = await onboardVenue(cfg.acuityUrl, extract, hints, cfg.overrides);
  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
