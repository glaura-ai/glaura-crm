import { describe, expect, it } from "vitest";
import { planOutreach, type PlanInput } from "./plan";
import { DEFAULT_OUTREACH_SETTINGS as S } from "./settings";

const STEP2_AFTER_START_MS = 2 * 24 * 3600000;
const STEP3_AFTER_START_MS = 5 * 24 * 3600000;

const H = 3600000;
const D = 24 * H;
// 2026-11-18 (CET, UTC+1). 10:00 Paris = 09:00Z.
const paris = (iso: string) => new Date(iso); // readability: pass explicit Z instants
const start = paris("2026-11-18T09:00:00Z"); // 10:00 Paris
const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  step: 0, startedAt: start, lastSentAt: null, phone: null, lastInboundAt: start, resolvedAt: null, qualification: "CHAUD",
  replies: [], salon: null, optedOut: false, now: start, settings: S, calendarUrl: "https://cal.example/demo", name: "Léa", ...o,
});

describe("stop rules", () => {
  it.each([["SIGNE"], ["PAS_INTERESSE"]])("stops when the salon is %s", status => {
    expect(planOutreach(base({ salon: { status, accountStatusLabel: null } }))).toEqual({ kind: "stop", reason: "SALON_CLOSED" });
  });
  it("stops once a demo is booked", () => {
    expect(planOutreach(base({ salon: { status: "INTERESSE", accountStatusLabel: "demo_booked" } }))).toEqual({ kind: "stop", reason: "DEMO_BOOKED" });
  });
  it("stops on a cold lead", () => { expect(planOutreach(base({ qualification: "FROID" }))).toEqual({ kind: "stop", reason: "COLD" }); });
  it("stops when the conversation is resolved", () => { expect(planOutreach(base({ resolvedAt: start }))).toEqual({ kind: "stop", reason: "CONVERSATION_DONE" }); });
  it("opt-out only blocks WhatsApp steps", () => {
    expect(planOutreach(base({ optedOut: true })).kind).toBe("send_instagram");
    expect(planOutreach(base({ step: 2, phone: "+33612345678", optedOut: true, now: new Date(start.getTime() + 3 * D) }))).toEqual({ kind: "stop", reason: "WHATSAPP_OPT_OUT" });
  });
});

describe("step 0", () => {
  it("sends the Instagram intro immediately, even outside send hours", () => {
    const now = paris("2026-11-18T01:00:00Z"); // 02:00 Paris
    const p = planOutreach(base({ now, lastInboundAt: now }));
    expect(p).toMatchObject({ kind: "send_instagram", step: 0 });
    expect((p as { text: string }).text).toContain("https://cal.example/demo");
  });
  it("window closed: skips to WhatsApp when the phone is known, else fails", () => {
    const now = new Date(start.getTime() + 25 * H);
    expect(planOutreach(base({ now, phone: "+33612345678" }))).toMatchObject({ kind: "skip", toStep: 2 });
    expect(planOutreach(base({ now }))).toEqual({ kind: "stop", reason: "SEND_FAILED" });
  });
  it("no inbound at all counts as a closed window", () => {
    expect(planOutreach(base({ lastInboundAt: null }))).toEqual({ kind: "stop", reason: "SEND_FAILED" });
  });
});

describe("step 1", () => {
  const sent = (o: Partial<PlanInput> = {}) => base({ step: 1, lastSentAt: start, ...o });
  it("waits until inbound + 20h when that is within hours", () => {
    // inbound 10:00 Paris -> target 06:00 next day (out of hours) ... use afternoon inbound
    const inbound = paris("2026-11-18T13:00:00Z"); // 14:00 Paris, target 10:00 Paris next day
    const p = planOutreach(sent({ lastInboundAt: inbound, now: new Date(inbound.getTime() + H) }));
    expect(p).toEqual({ kind: "wait", nextRunAt: new Date(inbound.getTime() + 20 * H) });
  });
  it("sends the reminder once due and in hours", () => {
    const inbound = paris("2026-11-18T13:00:00Z");
    const now = new Date(inbound.getTime() + 20 * H + 60000);
    expect(planOutreach(sent({ lastInboundAt: inbound, now }))).toMatchObject({ kind: "send_instagram", step: 1 });
  });
  it("reminder text asks for a number only when none is known", () => {
    const inbound = paris("2026-11-18T13:00:00Z");
    const now = new Date(inbound.getTime() + 20 * H + 60000);
    const a = planOutreach(sent({ lastInboundAt: inbound, now })) as { text: string };
    const b = planOutreach(sent({ lastInboundAt: inbound, now, phone: "+33612345678" })) as { text: string };
    expect(a.text).toContain("WhatsApp"); expect(b.text).not.toContain("WhatsApp");
  });
  it("target out of hours: uses the latest in-hours instant before the window closes", () => {
    const inbound = paris("2026-11-18T08:30:00Z"); // 09:30 Paris, target 05:30 Paris next day, window closes 09:30
    const p = planOutreach(sent({ lastInboundAt: inbound, now: new Date(inbound.getTime() + H) })) as { kind: string; nextRunAt: Date };
    expect(p.kind).toBe("wait");
    const t = p.nextRunAt.getTime();
    expect(t).toBeLessThan(inbound.getTime() + 24 * H);
    expect(t).toBeGreaterThan(inbound.getTime() + 20 * H);
    expect(t).toBe(paris("2026-11-19T08:25:00Z").getTime()); // 09:25 Paris, 5 min safety margin
  });
  it("target at night with no in-hours slot left before closing: uses the evening before, if still ahead", () => {
    const inbound = paris("2026-11-18T01:00:00Z"); // 02:00 Paris, target 22:00 Paris, closes 02:00 next day
    const p = planOutreach(sent({ lastInboundAt: inbound, now: new Date(inbound.getTime() + H) }));
    expect(p).toEqual({ kind: "wait", nextRunAt: paris("2026-11-18T18:59:00Z") }); // 19:59 Paris
  });
  it("skips to step 2 when no in-hours slot remains", () => {
    const inbound = paris("2026-11-18T01:00:00Z");
    const now = paris("2026-11-18T20:30:00Z"); // 21:30 Paris, window closes 02:00
    expect(planOutreach(sent({ lastInboundAt: inbound, now, phone: "+33612345678" }))).toMatchObject({ kind: "skip", toStep: 2 });
  });
  it("skips once the window is closed", () => {
    expect(planOutreach(sent({ now: new Date(start.getTime() + 25 * H) }))).toMatchObject({ kind: "skip", toStep: 2 });
  });
  it("a new inbound after step 0 moves the window (target follows lastInboundAt)", () => {
    // a contact reply would stop the sequence; an inbound that precedes lastSentAt just extends the window
    const inbound = paris("2026-11-18T13:00:00Z");
    expect(planOutreach(sent({ lastInboundAt: inbound, now: inbound })).kind).toBe("wait");
  });
});

describe("step 2 and 3", () => {
  const phone = "+33612345678";
  const at = (ms: number) => new Date(start.getTime() + ms);
  const sent = (o: Partial<PlanInput> = {}) => base({ step: 2, lastSentAt: start, lastInboundAt: start, ...o });
  it("step 2 waits for startedAt + 2d", () => {
    expect(planOutreach(sent({ phone, now: at(D) }))).toEqual({ kind: "wait", nextRunAt: at(STEP2_AFTER_START_MS) });
  });
  it("step 2 sends template 1 when due in hours", () => {
    expect(planOutreach(sent({ phone, now: at(STEP2_AFTER_START_MS) }))).toEqual({ kind: "send_whatsapp", step: 2, template: 1 });
  });
  it("step 2 due out of hours waits for 09:00 Paris", () => {
    const st = paris("2026-11-18T20:00:00Z"); // 21:00 Paris -> due 21:00 on the 20th
    const p = planOutreach(sent({ startedAt: st, lastSentAt: st, lastInboundAt: st, phone, now: new Date(st.getTime() + 2 * D + 60000) }));
    expect(p).toEqual({ kind: "wait", nextRunAt: paris("2026-11-21T08:00:00Z") });
  });
  it("step 2 without a phone goes straight to step 3", () => {
    expect(planOutreach(sent({ now: at(H) }))).toEqual({ kind: "skip", toStep: 3, nextRunAt: at(STEP3_AFTER_START_MS) });
  });
  it("step 3 sends template 2, or creates a task without phone", () => {
    expect(planOutreach(sent({ step: 3, phone, now: at(STEP3_AFTER_START_MS) }))).toEqual({ kind: "send_whatsapp", step: 3, template: 2 });
    expect(planOutreach(sent({ step: 3, now: at(STEP3_AFTER_START_MS) }))).toEqual({ kind: "create_task" });
    expect(planOutreach(sent({ step: 3, phone, now: at(4 * D) })).kind).toBe("wait");
  });
  it("is done after step 3", () => { expect(planOutreach(sent({ step: 4, phone }))).toEqual({ kind: "done" }); });
});

describe("DST", () => {
  it("clamps correctly in summer time (UTC+2)", () => {
    const st = paris("2026-07-01T19:00:00Z"); // 21:00 Paris
    const p = planOutreach(base({ step: 2, startedAt: st, lastSentAt: st, lastInboundAt: st, phone: "+33612345678", now: new Date(st.getTime() + 2 * D + 1) }));
    expect(p).toEqual({ kind: "wait", nextRunAt: paris("2026-07-04T07:00:00Z") }); // 09:00 Paris
  });
  it("handles the spring-forward night (2027-03-28)", () => {
    const st = paris("2027-03-26T22:00:00Z"); // 23:00 Paris (CET)
    const p = planOutreach(base({ step: 2, startedAt: st, lastSentAt: st, lastInboundAt: st, phone: "+33612345678", now: new Date(st.getTime() + 2 * D + 1) }));
    expect(p).toEqual({ kind: "wait", nextRunAt: paris("2027-03-29T07:00:00Z") }); // 09:00 CEST
  });
});

describe("replies", () => {
  const sentAt = new Date(start.getTime() + 2 * H);
  const reply = (text: string) => ({ text, sentAt: new Date(start.getTime() + 3 * H) });
  const now = new Date(start.getTime() + 4 * H);
  const common = { step: 1, lastSentAt: sentAt, now };
  it("any reply after our message stops the sequence", () => {
    expect(planOutreach(base({ ...common, replies: [reply("ok je regarde")] }))).toEqual({ kind: "stop", reason: "REPLIED" });
  });
  it("a reply with a mobile when we had none jumps to step 2 and is acknowledged", () => {
    const r = reply("vous pouvez m'écrire au 06 12 34 56 78");
    const p = planOutreach(base({ ...common, replies: [r] }));
    expect(p).toMatchObject({ kind: "skip", toStep: 2, phone: "+33612345678", ackAt: r.sentAt });
  });
  it("jump goes to the next in-hours slot, not startedAt + 2d", () => {
    const night = paris("2026-11-18T21:00:00Z"); // 22:00 Paris
    const p = planOutreach(base({ step: 1, lastSentAt: sentAt, now: night, replies: [{ text: "07 11 22 33 44", sentAt: night }] }));
    expect(p).toMatchObject({ kind: "skip", toStep: 2, nextRunAt: paris("2026-11-19T08:00:00Z") });
  });
  it("a reply with a number when we already had one is a plain reply", () => {
    expect(planOutreach(base({ ...common, phone: "+33699999999", replies: [reply("06 12 34 56 78")] }))).toEqual({ kind: "stop", reason: "REPLIED" });
  });
  it("a later non-phone reply stops even if an earlier one had a number", () => {
    expect(planOutreach(base({ ...common, replies: [reply("06 12 34 56 78"), reply("finalement non")] }))).toEqual({ kind: "stop", reason: "REPLIED" });
  });
  it("jumping to WhatsApp respects opt-out", () => {
    expect(planOutreach(base({ ...common, optedOut: true, replies: [reply("06 12 34 56 78")] }))).toEqual({ kind: "stop", reason: "WHATSAPP_OPT_OUT" });
  });
  it("stop rules win over replies", () => {
    expect(planOutreach(base({ ...common, qualification: "FROID", replies: [reply("06 12 34 56 78")] }))).toEqual({ kind: "stop", reason: "COLD" });
  });
});

describe("settings", () => {
  const inbound = paris("2026-11-18T13:00:00Z"); // 14:00 Paris
  it("renders {nom} and {lien_demo}", () => {
    const settings = { ...S, step0Text: "Salut {nom} ! {lien_demo}" };
    expect(planOutreach(base({ settings, name: "Studio Léa" }))).toEqual({ kind: "send_instagram", step: 0, text: "Salut Studio Léa ! https://cal.example/demo" });
  });
  it("uses the custom calendar url in the reminder, and appends the phone ask only without a phone", () => {
    const now = new Date(inbound.getTime() + 20 * H + 60000);
    const settings = { ...S, askPhoneText: "Ton numéro ?" };
    const a = planOutreach(base({ step: 1, lastSentAt: start, lastInboundAt: inbound, now, calendarUrl: "https://x.test/c", settings })) as { text: string };
    expect(a.text).toContain("https://x.test/c"); expect(a.text.endsWith("\nTon numéro ?")).toBe(true);
    const b = planOutreach(base({ step: 1, lastSentAt: start, lastInboundAt: inbound, now, phone: "+33612345678", settings })) as { text: string };
    expect(b.text).not.toContain("Ton numéro ?");
  });
  it("respects step1DelayHours", () => {
    const settings = { ...S, step1DelayHours: 4 };
    expect(planOutreach(base({ step: 1, lastSentAt: start, lastInboundAt: inbound, now: new Date(inbound.getTime() + H), settings }))).toEqual({ kind: "wait", nextRunAt: new Date(inbound.getTime() + 4 * H) });
  });
  it("respects custom step 2 and 3 delays", () => {
    const settings = { ...S, step2DelayDays: 3, step3DelayDays: 7 };
    const at = (ms: number) => new Date(start.getTime() + ms);
    const sent = (o: Partial<PlanInput>) => base({ step: 2, lastSentAt: start, phone: "+33612345678", settings, ...o });
    expect(planOutreach(sent({ now: at(2 * D) }))).toEqual({ kind: "wait", nextRunAt: at(3 * D) });
    expect(planOutreach(sent({ now: at(3 * D) }))).toMatchObject({ kind: "send_whatsapp", step: 2 });
    expect(planOutreach(sent({ step: 3, now: at(5 * D) }))).toEqual({ kind: "wait", nextRunAt: at(7 * D) });
    expect(planOutreach(sent({ phone: null, now: at(H) }))).toEqual({ kind: "skip", toStep: 3, nextRunAt: at(7 * D) });
  });
  it("respects custom send hours (due 10:00 Paris, window opens at 14:00)", () => {
    const settings = { ...S, sendHourStart: 14, sendHourEnd: 24 };
    const p = planOutreach(base({ step: 2, lastSentAt: start, phone: "+33612345678", settings, now: new Date(start.getTime() + 2 * D) }));
    expect(p).toEqual({ kind: "wait", nextRunAt: paris("2026-11-20T13:00:00Z") }); // 14:00 Paris
  });
});
