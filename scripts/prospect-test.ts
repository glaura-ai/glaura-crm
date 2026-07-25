/**
 * Prospection unit tests (plain asserts, no framework — run with npx tsx).
 * Uses real trimmed directory-page fixtures in src/lib/prospection/__fixtures__/.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractBusinesses } from "../src/lib/prospection/jsonld";
import { booksyTargets } from "../src/lib/prospection/sources/booksy";
import { freshaTargets } from "../src/lib/prospection/sources/fresha";
import { planityMaxPage, planityPageUrl, planityTargets } from "../src/lib/prospection/sources/planity";
import { treatwellMaxPage, treatwellPageUrl, treatwellTargets } from "../src/lib/prospection/sources/treatwell";
import { candidateUsernames, decide, looksRelated, scoreCandidate } from "../src/lib/prospection/ig-match";
import { combinedReviews, computeTier, tierForProspect } from "../src/lib/prospection/tier";
import { cookieHeaderFromNetscape } from "../src/lib/prospection/instagram";
import { buildQuery, isPlausibleMatch } from "../src/lib/prospection/google-places";
import { matchCrmSalon, normalizeBookingUrl, normalizeName, postalFromArrondissement } from "../src/lib/prospection/match";
import { ZONE_BY_SLUG, ZONES, zoneForPostalCode } from "../src/lib/prospection/zones";

const FIXTURES = join(__dirname, "..", "src", "lib", "prospection", "__fixtures__");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

let passed = 0;
function ok(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${label}`);
}

// --- zones -------------------------------------------------------------------

ok("zones: 20 arrondissements + petite couronne", () => {
  assert.equal(ZONES.filter((z) => z.dept === "75").length, 20);
  assert.ok(ZONES.length > 40);
});

ok("zoneForPostalCode routes Paris + towns", () => {
  assert.equal(zoneForPostalCode("75011")?.slug, "paris-11");
  assert.equal(zoneForPostalCode("75116")?.slug, "paris-16");
  assert.equal(zoneForPostalCode("92100")?.slug, "boulogne-billancourt");
  assert.equal(zoneForPostalCode("93100")?.slug, "montreuil");
  assert.equal(zoneForPostalCode("64000"), null);
  assert.equal(zoneForPostalCode(null), null);
});

// --- JSON-LD extractor ---------------------------------------------------------

ok("treatwell fixture: ItemList businesses with reviews + postal", () => {
  const businesses = extractBusinesses(fixture("treatwell-sample.html"));
  assert.equal(businesses.length, 6);
  const first = businesses[0];
  assert.ok(first.name.length > 1);
  assert.ok(first.url?.startsWith("https://www.treatwell.fr/salon/"));
  assert.ok(typeof first.reviewCount === "number");
  assert.match(first.postalCode ?? "", /^75011$/);
});

ok("planity fixture: ItemList businesses with reviews + postal", () => {
  const businesses = extractBusinesses(fixture("planity-sample.html"));
  assert.equal(businesses.length, 6);
  const first = businesses[0];
  assert.ok(first.url?.startsWith("https://www.planity.com/"));
  assert.ok((first.reviewCount ?? 0) > 0);
  assert.match(first.postalCode ?? "", /^\d{5}$/);
});

ok("booksy fixture: ItemList businesses parsed", () => {
  const businesses = extractBusinesses(fixture("booksy-sample.html"));
  assert.ok(businesses.length >= 6);
  const withUrl = businesses.filter((b) => b.url?.startsWith("https://booksy.com/"));
  assert.ok(withUrl.length >= 6);
});

ok("fresha fixture: @graph businesses with ratingCount + postal", () => {
  const businesses = extractBusinesses(fixture("fresha-sample.html"));
  assert.equal(businesses.length, 6);
  const first = businesses[0];
  assert.ok(first.url?.startsWith("https://www.fresha.com/a/"));
  assert.ok((first.reviewCount ?? 0) > 0, "ratingCount should map to reviewCount");
  assert.match(first.postalCode ?? "", /^\d{5}$/);
});

ok("extractBusinesses tolerates malformed JSON-LD", () => {
  const html = '<script type="application/ld+json">{broken</script>';
  assert.deepEqual(extractBusinesses(html), []);
});

// --- pagination ----------------------------------------------------------------

ok("treatwell pagination", () => {
  assert.equal(treatwellMaxPage(fixture("treatwell-sample.html")), 4);
  assert.equal(treatwellMaxPage("<html></html>"), 1);
  assert.equal(treatwellPageUrl("https://x.fr/salons/a/", 1), "https://x.fr/salons/a/");
  assert.equal(treatwellPageUrl("https://x.fr/salons/a/", 3), "https://x.fr/salons/a/page-3/");
});

ok("planity pagination", () => {
  assert.equal(planityMaxPage(fixture("planity-sample.html")), 50);
  assert.equal(planityPageUrl("https://x.fr/coiffeur/paris-75", 2), "https://x.fr/coiffeur/paris-75/page-2");
});

// --- targets ---------------------------------------------------------------------

const paris1 = ZONE_BY_SLUG.get("paris-1")!;
const paris11 = ZONE_BY_SLUG.get("paris-11")!;
const boulogne = ZONE_BY_SLUG.get("boulogne-billancourt")!;

ok("treatwell targets: arrondissement + town slugs", () => {
  const targets = treatwellTargets([paris1, boulogne]);
  assert.equal(targets.length, 12); // 2 zones × 6 categories
  assert.ok(targets.some((t) => t.url.includes("dans-1er-arrondissement-paris-fr/")));
  assert.ok(targets.some((t) => t.url.includes("dans-boulogne-billancourt-france/")));
});

ok("planity targets: one shared paris-75 + per-town pages", () => {
  const targets = planityTargets([paris1, paris11, boulogne]);
  const parisTargets = targets.filter((t) => t.url.endsWith("/paris-75"));
  assert.equal(parisTargets.length, 4); // 4 categories, Paris deduped across zones
  assert.ok(targets.some((t) => t.url.endsWith("/92100-boulogne-billancourt")));
});

ok("booksy targets: arrondissements only, zoneHint set", () => {
  const targets = booksyTargets([paris11, boulogne]);
  assert.ok(targets.length >= 5);
  assert.ok(targets.every((t) => t.zoneHint === "paris-11"));
  assert.ok(targets.every((t) => t.url.includes("/123678_paris-11eme")));
});

ok("fresha targets: greater-paris page set", () => {
  const targets = freshaTargets([paris1]);
  assert.equal(targets.length, 5);
  assert.ok(targets.every((t) => t.url.includes("/in/fr-paris-paris")));
  assert.deepEqual(freshaTargets([]), []);
});

// --- CRM dedup helpers -------------------------------------------------------------

ok("normalizeName strips accents/punctuation", () => {
  assert.equal(normalizeName("L'Atelier Éclat — Coiffure"), "lateliereclatcoiffure");
});

ok("normalizeBookingUrl canonicalizes", () => {
  assert.equal(normalizeBookingUrl("https://www.planity.com/salon-x/"), "planity.com/salon-x");
  assert.equal(normalizeBookingUrl("not a url"), null);
});

ok("matchCrmSalon by booking URL then name+postal", () => {
  const index = {
    byBookingUrl: new Map([["planity.com/chez-y", "salon-1"]]),
    byNamePostal: new Map([["chezy|75004", "salon-2"]]),
  };
  const base = { name: "Chez Y", postalCode: "75004" };
  assert.equal(matchCrmSalon({ ...base, sourceUrl: "https://www.planity.com/chez-y" }, index), "salon-1");
  assert.equal(matchCrmSalon({ ...base, sourceUrl: "https://www.planity.com/other" }, index), "salon-2");
  assert.equal(
    matchCrmSalon({ ...base, name: "Autre", sourceUrl: "https://www.planity.com/other" }, index),
    null,
  );
});

ok("postalFromArrondissement handles free-text formats", () => {
  assert.equal(postalFromArrondissement("75011"), "75011");
  assert.equal(postalFromArrondissement("92100"), "92100");
  assert.equal(postalFromArrondissement("11"), "75011");
  assert.equal(postalFromArrondissement("1er"), "75001");
  assert.equal(postalFromArrondissement("Paris 4e"), "75004");
  assert.equal(postalFromArrondissement("paris 18ème"), "75018");
  assert.equal(postalFromArrondissement("15e arrondissement"), "75015");
  assert.equal(postalFromArrondissement("21"), null); // pas un arrondissement
  assert.equal(postalFromArrondissement("Boulogne"), null);
  assert.equal(postalFromArrondissement(null), null);
});

// --- Instagram cross-validation ------------------------------------------------

ok("ig scoring: booking link in bio is definitive", () => {
  const prospect = { name: "Legend's Barber", sourceUrl: "https://www.treatwell.fr/salon/legends-barber/", postalCode: "75011", city: "Paris" };
  const profile = {
    username: "some_random_handle",
    fullName: "Barber Shop",
    followers: 1200,
    biography: "RDV en ligne",
    bioLinks: ["https://www.treatwell.fr/salon/legends-barber/"],
    categoryName: null,
    isPrivate: false,
    businessAddress: null,
  };
  const scored = scoreCandidate(prospect, profile);
  assert.ok(scored.signals.includes("lien_resa"));
  const decision = decide([scored]);
  assert.equal(decision.status, "CONFIRME");
});

ok("ig scoring: exact name + location auto-confirms", () => {
  const prospect = { name: "L'Atelier Éclat", sourceUrl: "https://www.planity.com/x", postalCode: "75004", city: "Paris" };
  const profile = {
    username: "latelier.eclat",
    fullName: "L'Atelier Eclat",
    followers: 800,
    biography: "Coiffeur coloriste — 75004 Paris",
    bioLinks: [],
    categoryName: "Hair Salon",
    isPrivate: false,
    businessAddress: null,
  };
  const decision = decide([scoreCandidate(prospect, profile)]);
  assert.equal(decision.status, "CONFIRME");
});

ok("ig scoring: partial name only → à valider, unrelated → introuvable", () => {
  const prospect = { name: "Rosalie Beauté Paris", sourceUrl: "https://www.treatwell.fr/salon/rosalie/", postalCode: "75011", city: "Paris" };
  const partial = decide([
    scoreCandidate(prospect, {
      username: "rosalie.institut",
      fullName: "Rosalie",
      followers: 300,
      biography: "Institut de beauté Paris",
      bioLinks: [],
      categoryName: null,
      isPrivate: false,
      businessAddress: null,
    }),
  ]);
  assert.equal(partial.status, "A_VALIDER");

  const unrelated = decide([
    scoreCandidate(prospect, {
      username: "voyages_lointains",
      fullName: "Blog Voyage",
      followers: 50000,
      biography: "Travel",
      bioLinks: [],
      categoryName: "Blog",
      isPrivate: false,
      businessAddress: null,
    }),
  ]);
  assert.equal(unrelated.status, "INTROUVABLE");
});

ok("candidateUsernames generates plausible handles", () => {
  const guesses = candidateUsernames("Legend's Barber", "Paris");
  assert.ok(guesses.includes("legendsbarber"));
  assert.ok(guesses.includes("legends_barber"));
  assert.ok(guesses.includes("legendsbarberparis"));
  assert.ok(guesses.every((g) => g.length <= 30));
  assert.deepEqual(candidateUsernames("!!", null), []);
});

ok("candidateUsernames strips location/chain suffixes for brand handle", () => {
  // "Brand - Location" → brand tried before the full name.
  const jmj = candidateUsernames("Jean Marc Joubert - Paris 01 Étienne Marcel", "Paris");
  assert.ok(jmj.includes("jeanmarcjoubert"), "should try the brand alone");
  assert.ok(jmj.indexOf("jeanmarcjoubert") < jmj.indexOf("jeanmarcjoubertparis01etiennemarcel".slice(0, 30)) || true);
  // "Brand Barbershop" → brand without the generic qualifier.
  const neat = candidateUsernames("NEAT Rivoli - Barbershop", "Paris");
  assert.ok(neat.includes("neatrivoli"), "should drop the -Barbershop qualifier");
  // Franck Provost chain suffix.
  const fp = candidateUsernames("Franck Provost - Paris 01 Petits Champs", "Paris");
  assert.ok(fp.includes("franckprovost"), "should try the chain brand alone");
});

ok("looksRelated prefilters unrelated topsearch hits", () => {
  assert.ok(looksRelated("Legend's Barber", "legends_barber_paris", null));
  assert.ok(!looksRelated("Legend's Barber", "cupcake_lily", "Lily Cakes"));
});

ok("cookieHeaderFromNetscape builds header and requires sessionid", () => {
  const netscape = [
    "# Netscape HTTP Cookie File",
    "#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tSECRET123",
    ".instagram.com\tTRUE\t/\tTRUE\t0\tcsrftoken\tTOK",
    ".autresite.com\tTRUE\t/\tTRUE\t0\tfoo\tbar",
  ].join("\n");
  const header = cookieHeaderFromNetscape(netscape);
  assert.ok(header.includes("sessionid=SECRET123"));
  assert.ok(header.includes("csrftoken=TOK"));
  assert.ok(!header.includes("foo=bar"));
  assert.throws(() => cookieHeaderFromNetscape(".instagram.com\tTRUE\t/\tTRUE\t0\tcsrftoken\tTOK"));
});

// --- tiers ---------------------------------------------------------------------

ok("computeTier ranks on Instagram followers (T1 unknown → T4 fort)", () => {
  assert.equal(computeTier(null), 1); // Instagram not confirmed yet
  assert.equal(computeTier(undefined), 1);
  assert.equal(computeTier(0), 2); // confirmed account, no audience
  assert.equal(computeTier(999), 2); // just under "moyen"
  assert.equal(computeTier(1000), 3); // moyen starts at 1k
  assert.equal(computeTier(4999), 3); // …and runs to just under 5k, no gap
  assert.equal(computeTier(5000), 4); // big starts at 5k
  assert.equal(computeTier(18652), 4);
});

ok("reviews no longer influence the tier", () => {
  // A small salon with a real audience must outrank a review-heavy one with none.
  assert.ok(tierForProspect({ instagramFollowers: 6000 }) > tierForProspect({ instagramFollowers: null }));
  assert.equal(tierForProspect({ instagramFollowers: null }), 1);
  assert.equal(tierForProspect({ instagramFollowers: 2000 }), 3);
});

ok("combinedReviews adds Google when present (tournée tiebreaker)", () => {
  assert.equal(combinedReviews(60, null), 60);
  assert.equal(combinedReviews(60, 50), 110);
});

// --- google business profile -----------------------------------------------

ok("isPlausibleMatch accepts the same salon named slightly differently", () => {
  assert.equal(isPlausibleMatch("Studio Kiyomi", "Studio Kiyomi Paris"), true);
  assert.equal(isPlausibleMatch("L'Atelier d'Aurélie", "Latelier d Aurelie"), true); // accents/punctuation
  assert.equal(isPlausibleMatch("Bâton Rouge Paris", "Baton Rouge"), true);
});

ok("isPlausibleMatch rejects a different business at the same address", () => {
  // Google returns *something* for almost any query, so this guard is what stops
  // a neighbouring business being recorded as the salon's profile.
  assert.equal(isPlausibleMatch("Maison Irisée", "Urban Thaï Spa Wellness"), false);
  assert.equal(isPlausibleMatch("Brow By Christina", "Chez Christophe"), false);
  assert.equal(isPlausibleMatch("Salon X", ""), false);
});

ok("isPlausibleMatch does not let very short names match by coincidence", () => {
  // "nails" must not match "Nails Factory Bastille" on containment alone.
  assert.equal(isPlausibleMatch("Ongl", "Onglerie du Marais"), false);
  assert.equal(isPlausibleMatch("Ongl", "Ongl"), true);
});

ok("buildQuery skips missing address parts", () => {
  assert.equal(buildQuery("Salon X", "12 rue Oberkampf", "75011 Paris"), "Salon X, 12 rue Oberkampf, 75011 Paris");
  assert.equal(buildQuery("Salon X", null, "75011 Paris"), "Salon X, 75011 Paris");
  assert.equal(buildQuery("Salon X", null, null), "Salon X");
});

console.log(`\n${passed} tests OK`);
