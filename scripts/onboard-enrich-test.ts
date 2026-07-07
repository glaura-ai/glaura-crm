/**
 * Unit tests for the P6 full-onboarding enrichment transforms (options,
 * agents, reviews, deposit, credentials/enable). Plain assertions, no
 * framework — exits non-zero on any failure.
 *
 * Usage: npx tsx scripts/onboard-enrich-test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as cheerio from "cheerio";
import {
  extractPlanityOptionGraph,
  trimHtmlForExtraction,
  type ExtractedService,
  type SalonExtract,
} from "../src/lib/onboarding/extract";
import {
  buildAgentDocs,
  buildReviewDocs,
  buildServicesPayload,
  buildUserProfile,
} from "../src/lib/onboarding/account-model";
import { hoursToTiming } from "../src/lib/onboarding/hours";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(path.join(__dirname, "..", "src", "lib", "onboarding", "__fixtures__", "planity-sample.html"), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures += 1;
}

// ---------------------------------------------------------------------------
// 1. extractPlanityOptionGraph — section-shared options + subcategory order
// ---------------------------------------------------------------------------

const $ = cheerio.load(FIXTURE);
const graph = extractPlanityOptionGraph($);

check("subcategory order: HEAD SPA=0, COLORATION=1",
  graph.orderBySubcategory.get("head spa") === 0 && graph.orderBySubcategory.get("coloration") === 1,
  JSON.stringify([...graph.orderBySubcategory]));

const headSpaOpts = graph.optionsByService.get("head spa||afro head spa experience 1h (sechage inclus)");
check("head-spa base gets 2 options (Finition + Supplément)", headSpaOpts?.length === 2, JSON.stringify(headSpaOpts));
check("option prices parsed (40, 20)", headSpaOpts?.[0].price === 40 && headSpaOpts?.[1].price === 20);
check("option duration: Finition=30, Supplément=null",
  headSpaOpts?.[0].duration_minutes === 30 && headSpaOpts?.[1].duration_minutes === null);
check("diagnostic does NOT receive options",
  !graph.optionsByService.has("head spa||diagnostic capillaire"));
check("no-option subcategory (Balayage) absent from options map",
  !graph.optionsByService.has("coloration||balayage blond"));

// trim must exclude Finition/Supplément rows so Haiku never emits them as services
const trimmed = trimHtmlForExtraction(FIXTURE, "planity");
check("trimmed text keeps base service", trimmed.includes("AFRO HEAD SPA"));
check("trimmed text drops 'Finition Silk Press'", !trimmed.includes("Finition Silk Press"));
check("trimmed text drops 'Supplément Cheveux'", !trimmed.includes("Supplément Cheveux"));

// ---------------------------------------------------------------------------
// 2. buildServicesPayload — variants, base_option_label, order, combined price
// ---------------------------------------------------------------------------

const svc = (over: Partial<ExtractedService>): ExtractedService => ({
  service_name: "x", subcategory_name: "s", category: "Coiffure", service_details: "",
  service_price: 0, duration_minutes: null, ...over,
});

const extract: SalonExtract = {
  salon: { name: "Fixture Salon", address: "1 rue Test", phone: "01", bio: "bio",
    images: ["https://img/main.jpg", "https://img/g1.jpg"], hours: { Mon: { open: "10:00", close: "19:00" } } },
  staff: [],
  reviews: [{ author: "Réel A", rating: 4.5, text: "Super salon, je recommande." }],
  services: [
    svc({ service_name: "Balayage Blond", subcategory_name: "COLORATION", service_price: 120, duration_minutes: 120, subcategory_order: 1 }),
    svc({ service_name: "AFRO HEAD SPA EXPÉRIENCE 1H (séchage inclus)", subcategory_name: "HEAD SPA",
      service_price: 90, duration_minutes: 60, subcategory_order: 0,
      options: [
        { name: "Finition Silk Press", price: 40, duration_minutes: 30 },
        { name: "Supplément Cheveux longs/épais", price: 20, duration_minutes: null },
      ] }),
  ],
};

const built = buildServicesPayload(extract, "owner1");
check("services emitted in page order (HEAD SPA before COLORATION)",
  built.payload.services[0].subcategory_name === "HEAD SPA" && built.payload.services[1].subcategory_name === "COLORATION");
const patch = built.variantsByServiceName["afro head spa experience 1h (sechage inclus)"];
check("base_option_label set to base service name", patch?.base_option_label === "AFRO HEAD SPA EXPÉRIENCE 1H (séchage inclus)");
check("variant 1 = base+option price/duration (130 / 90min)",
  patch?.variants[0].price === 130 && patch?.variants[0].durationMinutes === 90);
check("variant 2 duration = base+0 (60), price 110",
  patch?.variants[1].price === 110 && patch?.variants[1].durationMinutes === 60);
check("variants carry generated ids + salonOnly=false",
  patch?.variants[0].id === "v_1" && patch?.variants[0].salonOnly === false);
check("service with no options has no patch", built.variantsByServiceName["balayage blond"] === undefined);

// ---------------------------------------------------------------------------
// 3. buildAgentDocs — N agents, each assigned to all services
// ---------------------------------------------------------------------------

const { timing, days } = hoursToTiming(extract.salon.hours);
const created = [
  { id: "svc1", category_id: "cat1", subcategory_id: "subA" },
  { id: "svc2", category_id: "cat1", subcategory_id: "subA" },
  { id: "svc3", category_id: "cat2", subcategory_id: "subB" },
];
const agents = buildAgentDocs(3, "owner1", timing, days, created);
check("3 agents created with distinct names", agents.length === 3 && new Set(agents.map((a) => a.name)).size === 3);
check("agent subcategoryServices covers all services",
  agents[0].subcategoryServices["subA"]?.length === 2 && agents[0].subcategoryServices["subB"]?.length === 1);
check("agent categorySubcategories groups subcats under categories",
  agents[0].categorySubcategories["cat1"]?.includes("subA") && agents[0].categorySubcategories["cat2"]?.includes("subB"));

// ---------------------------------------------------------------------------
// 4. buildReviewDocs — real first (forced 5★), filled to target
// ---------------------------------------------------------------------------

const now = new Date("2026-07-07T12:00:00Z");
const reviews = buildReviewDocs([{ author: "Réel A", text: "Super salon." }, { author: "", text: "" }], 27, now);
check("exactly 27 reviews", reviews.reviews.length === 27);
check("all reviews are 5★", reviews.reviews.every((r) => r.ratting === 5));
check("first review is the real one (text preserved)", reviews.reviews[0].review === "Super salon.");
check("empty real review skipped, filler used from index 1", reviews.reviews[1].review.length > 0);
check("aggregate avg=5 total=27", reviews.avg_ratting === 5 && reviews.total_review === 27);
check("createdAt descends from now", reviews.reviews[0].createdAt.getTime() > reviews.reviews[1].createdAt.getTime());

// ---------------------------------------------------------------------------
// 5. buildUserProfile — enable/deposit/profileImg overrides
// ---------------------------------------------------------------------------

const profile = buildUserProfile(extract, {
  uid: "u1", email: "fhcpro7@gmail.com", companyUserName: "fhc", timing, days,
  searchNameList: [], lat: 48.8, lng: 2.3, crmSourceUrl: "url", enable: true, deposit: 30,
  profileImg: "https://storage.googleapis.com/glaura-user-media-eu/profile_images/u1_1.jpg",
  salonImages: ["https://storage.googleapis.com/glaura-user-media-eu/salon_images/u1/0-1.jpg"],
});
check("enable=true flips enable/isActive/available", profile.enable && profile.isActive && profile.available);
check("deposit written to spdeposit + depositPercentage", profile.spdeposit === 30 && profile.depositPercentage === 30);
check("profileImg from ctx (re-hosted); salon_images is an array", profile.profileImg.includes("glaura-user-media-eu") && Array.isArray(profile.salon_images) && profile.salon_images.length === 1);

const disabled = buildUserProfile(extract, {
  uid: "u2", email: "x@glaura.fr", companyUserName: "x", timing, days, searchNameList: [], lat: null, lng: null, crmSourceUrl: "url",
});
check("default (no overrides) stays disabled, deposit 0", !disabled.enable && disabled.spdeposit === 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
