#!/usr/bin/env node
// Convert scraped opening hours into the Firestore userProfile `timing` + `days`
// format, so the onboarding agent never has to compute epoch timestamps itself
// (that math + DST handling is the bug that produced all-"Fermé" profiles).
//
// Salon profiles store `timing` as { Sun..Sat: [openEpochSec, closeEpochSec] }
// where each epoch renders, in Europe/Paris, to the salon's local clock time
// (matches how goglow-serviceprovider writes it and the website reads it).
// Closed days are []. All 7 keys are always present. `days` is the integer
// array of OPEN days (0=Sun … 6=Sat).
//
// Usage:
//   node hours-to-timing.mjs '{"Mon":"closed","Tue":"10:00-19:00","Wed":"10:00-19:00","Thu":"10:00-20:00","Fri":"10:00-20:00","Sat":"10:00-20:00","Sun":"closed"}'
// Day keys may be French (Lundi…), English long (Monday…) or short (Mon…),
// case-insensitive. A closed day is "closed", "Fermé", "" or omitted.
// Prints {"timing":{…},"days":[…]} to stdout.

const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALIASES = {
  sun: 0, dim: 0, dimanche: 0, sunday: 0,
  mon: 1, lun: 1, lundi: 1, monday: 1,
  tue: 2, mar: 2, mardi: 2, tuesday: 2,
  wed: 3, mer: 3, mercredi: 3, wednesday: 3,
  thu: 4, jeu: 4, jeudi: 4, thursday: 4,
  fri: 5, ven: 5, vendredi: 5, friday: 5,
  sat: 6, sam: 6, samedi: 6, saturday: 6,
};

// UTC offset (hours) of Europe/Paris on a fixed summer reference date → CEST=+2.
// Using one reference date keeps the encoding consistent and DST-correct for
// the rendered clock time.
const REF = { y: 2025, m: 5, d: 15 }; // 2025-06-15, CEST
function parisOffsetHours() {
  const noonUtc = Date.UTC(REF.y, REF.m, REF.d, 12, 0, 0);
  const parisHour = Number(
    new Date(noonUtc).toLocaleString("en-US", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }),
  );
  return parisHour - 12;
}
const OFFSET = parisOffsetHours();

function render(epochSec) {
  return new Date(epochSec * 1000).toLocaleTimeString("fr-FR", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Paris",
  });
}

// Epoch (seconds) that renders to HH:MM in Europe/Paris on the reference date.
function toEpoch(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`bad time "${hhmm}" (want HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  const epoch = Date.UTC(REF.y, REF.m, REF.d, h - OFFSET, min, 0) / 1000;
  const got = render(epoch);
  const want = `${String(h).padStart(2, "0")}:${m[2]}`;
  if (got !== want) throw new Error(`epoch self-check failed for ${hhmm}: rendered ${got}`);
  return epoch;
}

function isClosed(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "" || s === "closed" || s === "fermé" || s === "ferme" || s === "fermée";
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: hours-to-timing.mjs '<json day->\"HH:MM-HH:MM\"|closed>'");
    process.exit(2);
  }
  const parsed = JSON.parse(input);
  const timing = { Sun: [], Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [] };
  const openDays = new Set();

  for (const [rawKey, rawVal] of Object.entries(parsed)) {
    const idx = ALIASES[rawKey.trim().toLowerCase()];
    if (idx === undefined) throw new Error(`unknown day key "${rawKey}"`);
    const key = SHORT[idx];
    if (isClosed(rawVal)) { timing[key] = []; continue; }
    const range = String(rawVal).replace(/[–—]/g, "-").split("-");
    if (range.length !== 2) throw new Error(`bad range "${rawVal}" for ${rawKey} (want "HH:MM-HH:MM")`);
    timing[key] = [toEpoch(range[0]), toEpoch(range[1])];
    openDays.add(idx);
  }

  const days = [...openDays].sort((a, b) => a - b);
  process.stdout.write(JSON.stringify({ timing, days }));
}

main();
