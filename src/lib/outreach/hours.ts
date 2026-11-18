import { SEND_HOURS_PARIS } from "./config";

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
function parts(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour };
}
/** The instant at which Paris wall-clock reads y-m-d h:00 (handles DST). */
function parisInstant(y: number, m: number, d: number, h: number) {
  const guess = Date.UTC(y, m - 1, d, h);
  let t = guess;
  for (let i = 0; i < 2; i++) { const p = parts(new Date(t)); t += guess - Date.UTC(p.y, p.m - 1, p.d, p.h); }
  return new Date(t);
}
export function inSendHours(d: Date) {
  const { h } = parts(d);
  return h >= SEND_HOURS_PARIS.start && h < SEND_HOURS_PARIS.end;
}
/** `d` if inside send hours, else the next opening (09:00 Paris). */
export function nextSendSlot(d: Date) {
  if (inSendHours(d)) return d;
  const p = parts(d);
  const day = p.h < SEND_HOURS_PARIS.start ? p.d : p.d + 1;
  return parisInstant(p.y, p.m, day, SEND_HOURS_PARIS.start);
}
/** Latest in-hours instant ≤ `limit` and ≥ `notBefore`, or null. */
export function latestSendSlot(limit: Date, notBefore: Date) {
  let t = limit;
  if (!inSendHours(t)) {
    const p = parts(t);
    const day = p.h < SEND_HOURS_PARIS.start ? p.d - 1 : p.d;
    t = new Date(parisInstant(p.y, p.m, day, SEND_HOURS_PARIS.end).getTime() - 60000);
  }
  return t.getTime() >= notBefore.getTime() ? t : null;
}
