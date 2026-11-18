import { expect, it } from "vitest";
import { inSendHours, latestSendSlot, nextSendSlot } from "./hours";

const z = (iso: string) => new Date(iso);
// 2026-11-18 is CET (UTC+1): 09:00Z = 10:00 Paris.
it("inSendHours follows the given window, end exclusive, end may be 24", () => {
  expect(inSendHours(z("2026-11-18T09:00:00Z"), { start: 9, end: 20 })).toBe(true);
  expect(inSendHours(z("2026-11-18T19:00:00Z"), { start: 9, end: 20 })).toBe(false); // 20:00
  expect(inSendHours(z("2026-11-18T22:30:00Z"), { start: 9, end: 24 })).toBe(true); // 23:30
  expect(inSendHours(z("2026-11-18T09:00:00Z"), { start: 11, end: 24 })).toBe(false);
});
it("nextSendSlot opens at the configured start", () => {
  expect(nextSendSlot(z("2026-11-18T09:00:00Z"), { start: 11, end: 20 })).toEqual(z("2026-11-18T10:00:00Z"));
  expect(nextSendSlot(z("2026-11-18T20:00:00Z"), { start: 11, end: 20 })).toEqual(z("2026-11-19T10:00:00Z"));
});
it("latestSendSlot backs off to one minute before the configured end", () => {
  expect(latestSendSlot(z("2026-11-18T22:00:00Z"), z("2026-11-18T09:00:00Z"), { start: 9, end: 18 })).toEqual(z("2026-11-18T16:59:00Z"));
  expect(latestSendSlot(z("2026-11-18T22:00:00Z"), z("2026-11-18T20:00:00Z"), { start: 9, end: 18 })).toBeNull();
});
