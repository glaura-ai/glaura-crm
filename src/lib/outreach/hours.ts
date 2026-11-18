/** Send window in Paris hours; `end` may be 24. */
export type SendWindow = { start: number; end: number };

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
export function inSendHours(d: Date, w: SendWindow) {
  const { h } = parts(d);
  return h >= w.start && h < w.end;
}
/** `d` if inside send hours, else the next opening. */
export function nextSendSlot(d: Date, w: SendWindow) {
  if (inSendHours(d, w)) return d;
  const p = parts(d);
  const day = p.h < w.start ? p.d : p.d + 1;
  return parisInstant(p.y, p.m, day, w.start);
}
/** Latest in-hours instant ≤ `limit` and ≥ `notBefore`, or null. */
export function latestSendSlot(limit: Date, notBefore: Date, w: SendWindow) {
  let t = limit;
  if (!inSendHours(t, w)) {
    const p = parts(t);
    const day = p.h < w.start ? p.d - 1 : p.d;
    t = new Date(parisInstant(p.y, p.m, day, w.end).getTime() - 60000);
  }
  return t.getTime() >= notBefore.getTime() ? t : null;
}
