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

interface AcuityOnboardConfig {
  acuityUrl: string;
  crmSalonId?: string;
  salonName: string;
  address?: string;
  instagram?: string;
  bio?: string;
  /** Glaura category applied to every service (Acuity categories are freeform). Default "Coiffure". */
  category?: GlauraCategoryName;
  /** Per-day opening hours (extract HoursSchema shape). Days omitted => closed. */
  hours: SalonExtract["salon"]["hours"];
  /** Explicit gallery URLs; when omitted, JPEG images are auto-scraped from the page description. */
  images?: string[];
  overrides?: OnboardingOverrides;
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

type AcuityType = { name: string; price: string; duration: number; description?: string; active?: boolean };

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

  const services: ExtractedService[] = [];
  Object.entries(grouped).forEach(([subcategory, items], order) => {
    for (const t of items) {
      if (t.active === false) continue;
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
  if (services.length === 0) throw new Error("no active appointment types parsed");

  const images = cfg.images ?? scrapeDescriptionImages(html);

  const extract: SalonExtract = {
    salon: {
      name: cfg.salonName,
      address: cfg.address ?? null,
      phone: null,
      bio: cfg.bio ?? null,
      images,
      hours: cfg.hours,
    },
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

  console.log(`Parsed ${services.length} services / ${new Set(services.map((s) => s.subcategory_name)).size} subcategories, ${images.length} images.`);
  for (const s of services) console.log(`  [${s.subcategory_order}] ${s.subcategory_name} :: ${s.service_name} — ${s.service_price}€ / ${s.duration_minutes}min`);
  console.log("Overrides:", JSON.stringify(cfg.overrides ?? {}));

  if (dry) {
    console.log("\n--dry: no writes performed.");
    return;
  }

  // Imported here (not top-level) so env is loaded before firebase-admin initializes.
  const { createDisabledSalonAccount } = await import("@/lib/onboarding/create-account");
  const result = await createDisabledSalonAccount(extract, hints, { url: cfg.acuityUrl, sourceType: "acuity" }, cfg.overrides);
  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
