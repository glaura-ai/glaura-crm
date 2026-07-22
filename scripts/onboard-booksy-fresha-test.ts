/**
 * Unit tests for the Booksy + Fresha deterministic trim parsers.
 * Plain assertions, no framework — exits non-zero on any failure.
 *
 * Usage: npx tsx scripts/onboard-booksy-fresha-test.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { detectSource } from "../src/lib/onboarding/expand";
import { trimHtmlForExtraction } from "../src/lib/onboarding/extract";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "..", "src", "lib", "onboarding", "__fixtures__");
const read = (f: string) => readFileSync(path.join(fixtures, f), "utf8");

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

// ---- detectSource ----
console.log("detectSource:");
assert(detectSource("https://booksy.com/fr-fr/13617_x_onglerie_99219_paris") === "booksy", "booksy.com → booksy");
assert(detectSource("https://www.fresha.com/a/r-de-beaute-paris-14-t1ja2es9") === "fresha", "fresha.com → fresha");
assert(detectSource("https://sons.mytreatwell.fr/") === "treatwell", "mytreatwell.fr → treatwell (unchanged)");

// ---- Booksy ----
console.log("Booksy trim:");
const booksy = trimHtmlForExtraction(read("booksy-sample.html"), "booksy");
assert(/SALON NAME: BaddestNailsClub/.test(booksy), "name parsed");
assert(/ADDRESS: 80 Rue de Cléry/.test(booksy), "address from streetAddress");
assert(/FLASH CLASSIC \(niv\. 1\)/.test(booksy) && /price: 90 €/.test(booksy), "service + price parsed");
assert((booksy.match(/^- /gm) || []).length >= 3, "all 3 offers present");
assert(!/BreadcrumbList/.test(booksy), "breadcrumb node ignored");

// ---- Fresha ----
console.log("Fresha trim:");
const fresha = trimHtmlForExtraction(read("fresha-sample.html"), "fresha");
assert(/SALON NAME: R De Beauté/.test(fresha), "name parsed from __NEXT_DATA__");
assert(/ADDRESS: 14-20 rue Mathurin Régnier/.test(fresha), "address from shortFormatted");
assert(/Soin Visage Douceur à la Rose/.test(fresha) && /price: 35 €/.test(fresha), "service + price parsed");
assert(/duration: 30 min/.test(fresha), "duration from caption");
assert(/Monday: 10:00 AM - 6:00 PM/.test(fresha) && /Sunday: Fermé/.test(fresha), "hours (open + closed) parsed");
assert(/Violaine/.test(fresha), "staff parsed");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll Booksy/Fresha parser tests passed.");
