/**
 * Unit tests for the PURE salon-account-creation transforms (Step P3a).
 *
 * Usage: npx tsx scripts/onboard-model-test.ts
 *
 * No test framework — plain assertions, exits non-zero on any failure so it
 * can gate CI. Covers:
 *   1. hoursToTiming parity against the actual hours-to-timing.mjs script
 *      (run as a child process — never reimplement its math to compare
 *      against, that defeats the point of a parity check).
 *   2. buildSearchNameList keyword extraction.
 *   3. slugify + a simulated companyUserName suffix loop.
 *   4. buildUserProfile invariants (disabled account, CRM trace fields,
 *      salon_images as a string).
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hoursToTiming, type HoursInput, type TimingResult } from "../src/lib/onboarding/hours";
import { buildSearchNameList, buildUserProfile, slugify } from "../src/lib/onboarding/account-model";
import type { SalonExtract } from "../src/lib/onboarding/extract";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOURS_MJS_PATH = path.join(__dirname, "..", "onboarding", "scripts", "hours-to-timing.mjs");

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// 1. hoursToTiming parity against the real .mjs
// ---------------------------------------------------------------------------

/** A test case expressed both as .mjs CLI input and as the extract's HoursInput shape. */
interface HoursCase {
  name: string;
  mjsInput: Record<string, string>;
  tsInput: HoursInput;
}

const HOURS_CASES: HoursCase[] = [
  {
    name: "typical week (Mon + Sun closed)",
    mjsInput: {
      Mon: "closed",
      Tue: "10:00-19:00",
      Wed: "10:00-19:00",
      Thu: "10:00-20:00",
      Fri: "10:00-20:00",
      Sat: "10:00-20:00",
      Sun: "closed",
    },
    tsInput: {
      Mon: "closed",
      Tue: { open: "10:00", close: "19:00" },
      Wed: { open: "10:00", close: "19:00" },
      Thu: { open: "10:00", close: "20:00" },
      Fri: { open: "10:00", close: "20:00" },
      Sat: { open: "10:00", close: "20:00" },
      Sun: "closed",
    },
  },
  {
    name: "open every day, same hours",
    mjsInput: {
      Mon: "09:00-18:00",
      Tue: "09:00-18:00",
      Wed: "09:00-18:00",
      Thu: "09:00-18:00",
      Fri: "09:00-18:00",
      Sat: "09:00-18:00",
      Sun: "09:00-18:00",
    },
    tsInput: {
      Mon: { open: "09:00", close: "18:00" },
      Tue: { open: "09:00", close: "18:00" },
      Wed: { open: "09:00", close: "18:00" },
      Thu: { open: "09:00", close: "18:00" },
      Fri: { open: "09:00", close: "18:00" },
      Sat: { open: "09:00", close: "18:00" },
      Sun: { open: "09:00", close: "18:00" },
    },
  },
  {
    name: "weekdays only, weekend keys omitted entirely",
    mjsInput: {
      Mon: "09:30-17:45",
      Tue: "09:30-17:45",
      Wed: "09:30-17:45",
      Thu: "09:30-17:45",
      Fri: "09:30-17:45",
    },
    tsInput: {
      Mon: { open: "09:30", close: "17:45" },
      Tue: { open: "09:30", close: "17:45" },
      Wed: { open: "09:30", close: "17:45" },
      Thu: { open: "09:30", close: "17:45" },
      Fri: { open: "09:30", close: "17:45" },
      // Sat/Sun intentionally omitted — should be treated as closed.
    },
  },
];

function runMjs(input: Record<string, string>): TimingResult {
  const out = execFileSync("node", [HOURS_MJS_PATH, JSON.stringify(input)], {
    encoding: "utf8",
  });
  return JSON.parse(out) as TimingResult;
}

let firstHoursExample: { input: HoursInput; output: TimingResult } | null = null;

for (const testCase of HOURS_CASES) {
  const expected = runMjs(testCase.mjsInput);
  const actual = hoursToTiming(testCase.tsInput);
  check(
    `hoursToTiming parity: ${testCase.name}`,
    deepEqual(expected, actual),
    `mjs=${JSON.stringify(expected)} ts=${JSON.stringify(actual)}`,
  );
  if (!firstHoursExample) firstHoursExample = { input: testCase.tsInput, output: actual };
}

// ---------------------------------------------------------------------------
// 2. buildSearchNameList
// ---------------------------------------------------------------------------

const sampleName = "STB Paris";
const searchNameList = buildSearchNameList(sampleName);

check(
  "buildSearchNameList: contains single-letter prefixes",
  searchNameList.includes("s") && searchNameList.includes("p"),
);
check(
  "buildSearchNameList: contains per-word prefixes",
  searchNameList.includes("stb") && searchNameList.includes("paris") && searchNameList.includes("par"),
);
check(
  "buildSearchNameList: contains whole-string prefix",
  searchNameList.includes("stb paris"),
);
check(
  "buildSearchNameList: ignores blank/null args without throwing",
  deepEqual(buildSearchNameList(undefined, null, ""), []),
);

// ---------------------------------------------------------------------------
// 3. slugify + simulated suffix loop
// ---------------------------------------------------------------------------

const base = slugify("STB Paris");
check("slugify: lowercases + dashes", base === "stb-paris", `got "${base}"`);

const baseAccented = slugify("Étude d'Ongles");
check(
  "slugify: strips accents (NFD) and never throws on punctuation",
  baseAccented.length > 0 && baseAccented === baseAccented.toLowerCase(),
  `got "${baseAccented}"`,
);

check("slugify: empty/invalid input falls back", slugify("") === "" || slugify("") === "service-provider");

function resolveUsername(candidateBase: string, taken: ReadonlySet<string>): string {
  let candidate = candidateBase;
  let counter = 1;
  while (taken.has(candidate)) {
    candidate = `${candidateBase}-${counter}`;
    counter += 1;
  }
  return candidate;
}

const takenUsernames = new Set(["stb-paris", "stb-paris-1"]);
const resolved = resolveUsername(base, takenUsernames);
check("suffix loop: skips taken base and base-1, lands on base-2", resolved === "stb-paris-2", `got "${resolved}"`);

// ---------------------------------------------------------------------------
// 4. buildUserProfile invariants
// ---------------------------------------------------------------------------

const fakeExtract: SalonExtract = {
  salon: {
    name: "STB Paris",
    address: "12 Rue de Rivoli 75001 Paris",
    phone: "+33102030405",
    bio: "Un salon de beauté au coeur de Paris.",
    images: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    hours: {
      Mon: "closed",
      Tue: { open: "10:00", close: "19:00" },
      Wed: { open: "10:00", close: "19:00" },
      Thu: { open: "10:00", close: "20:00" },
      Fri: { open: "10:00", close: "20:00" },
      Sat: { open: "10:00", close: "20:00" },
      Sun: "closed",
    },
  },
  services: [
    {
      service_name: "Manucure",
      subcategory_name: "Onglerie",
      category: "Nails",
      service_details: "Pose vernis classique",
      service_price: 25,
      duration_minutes: 45,
    },
  ],
  staff: [],
  reviews: null,
};

const { timing, days } = hoursToTiming(fakeExtract.salon.hours);
const fixedNow = new Date("2026-07-04T00:00:00.000Z");

const profile = buildUserProfile(fakeExtract, {
  uid: "uid-123",
  email: "stb-paris@glaura.fr",
  companyUserName: "stb-paris",
  timing,
  days,
  searchNameList: buildSearchNameList(fakeExtract.salon.name),
  lat: 48.8566,
  lng: 2.3522,
  hints: { crmSalonId: "crm-abc-123" },
  crmSourceUrl: "https://www.planity.com/stb-paris",
  now: fixedNow,
});

check(
  "buildUserProfile: disabled invariant (enable/isActive/available all false)",
  profile.enable === false && profile.isActive === false && profile.available === false,
);
check(
  "buildUserProfile: CRM trace fields present",
  profile.crmSalonId === "crm-abc-123" &&
    profile.crmOnboardingMode === "headless" &&
    profile.crmSourceUrl === "https://www.planity.com/stb-paris",
);
check(
  "buildUserProfile: salon_images is a comma-joined string, not an array",
  typeof profile.salon_images === "string" &&
    profile.salon_images === "https://cdn.example.com/a.jpg,https://cdn.example.com/b.jpg",
);
check(
  "buildUserProfile: spLocation built from lat/lng",
  profile.spLocation !== null &&
    profile.spLocation.latitude === 48.8566 &&
    profile.spLocation.longitude === 2.3522,
);
check("buildUserProfile: createdAt/updatedAt use the injected `now`", profile.createdAt === fixedNow && profile.updatedAt === fixedNow);
check(
  "buildUserProfile: no crmSalonId hint falls back to null",
  buildUserProfile(fakeExtract, {
    uid: "uid-456",
    email: "x@glaura.fr",
    companyUserName: "x",
    timing,
    days,
    searchNameList: [],
    lat: null,
    lng: null,
    crmSourceUrl: "https://example.com",
    now: fixedNow,
  }).crmSalonId === null,
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("");
console.log("--- sample hoursToTiming input/output ---");
console.log(JSON.stringify(firstHoursExample, null, 2));
console.log("");
console.log(`--- buildSearchNameList("${sampleName}") sample (${searchNameList.length} keywords) ---`);
console.log(JSON.stringify(searchNameList.slice(0, 20)));

console.log("");
if (failures > 0) {
  console.error(`${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("All tests passed.");
}
