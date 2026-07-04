/**
 * Converts the extract's per-day opening-hours object into the Firestore
 * `userProfile.timing` + `userProfile.days` shape.
 *
 * This is a faithful TypeScript port of `onboarding/scripts/hours-to-timing.mjs`.
 * The epoch encoding (render each HH:MM local clock time onto a fixed CEST
 * reference date, Europe/Paris) is correctness-critical: a past bug that
 * hand-computed epochs produced all-"Fermé" profiles. Do NOT reimplement this
 * math from scratch — the reference date, offset computation, and
 * self-check below must match the .mjs exactly.
 *
 * Salon profiles store `timing` as { Sun..Sat: [openEpochSec, closeEpochSec] }
 * where each epoch renders, in Europe/Paris, to the salon's local clock time.
 * Closed days are `[]`. All 7 keys are always present. `days` is the integer
 * array of OPEN days (0=Sun … 6=Sat).
 */

import type { DayKey } from "./extract";

// Sun-first, 0-indexed order — matches the `days` field's 0=Sun..6=Sat contract.
const DAY_ORDER: readonly DayKey[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type DayHours = { open: string; close: string } | "closed";

/** Mirrors the extract's HoursSchema: every day key optional/nullable. */
export type HoursInput = Partial<Record<DayKey, DayHours | null | undefined>>;

export type Timing = Record<DayKey, [] | [number, number]>;

export interface TimingResult {
  timing: Timing;
  days: number[];
}

// UTC offset (hours) of Europe/Paris on a fixed summer reference date → CEST=+2.
// Using one reference date keeps the encoding consistent and DST-correct for
// the rendered clock time, regardless of when onboarding actually runs.
const REF = { y: 2025, m: 5, d: 15 }; // 2025-06-15, CEST

function parisOffsetHours(): number {
  const noonUtc = Date.UTC(REF.y, REF.m, REF.d, 12, 0, 0);
  const parisHour = Number(
    new Date(noonUtc).toLocaleString("en-US", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      hour12: false,
    }),
  );
  return parisHour - 12;
}

const OFFSET = parisOffsetHours();

function render(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Paris",
  });
}

/** Epoch (seconds) that renders to HH:MM in Europe/Paris on the reference date. */
function toEpoch(hhmm: string): number {
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

function isClosedValue(value: DayHours | null | undefined): boolean {
  if (value == null || value === "closed") return true;
  const s = String(value).trim().toLowerCase();
  return s === "" || s === "closed" || s === "fermé" || s === "ferme" || s === "fermée";
}

/**
 * Builds `{ timing, days }` from the extract's hours object. Days omitted
 * from `hours` are treated as closed, same as the .mjs (which only sets
 * entries present in its input, leaving the rest at their initialized `[]`).
 */
export function hoursToTiming(hours: HoursInput): TimingResult {
  const timing = { Sun: [], Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [] } as Timing;
  const openDays = new Set<number>();

  DAY_ORDER.forEach((key, idx) => {
    const value = hours[key];
    if (isClosedValue(value)) {
      timing[key] = [];
      return;
    }
    const { open, close } = value as { open: string; close: string };
    timing[key] = [toEpoch(open), toEpoch(close)];
    openDays.add(idx);
  });

  const days = [...openDays].sort((a, b) => a - b);
  return { timing, days };
}
