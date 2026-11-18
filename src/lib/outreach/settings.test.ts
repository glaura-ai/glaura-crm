import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { DEFAULT_OUTREACH_SETTINGS as D, outreachActive, outreachSettingsSchema as schema, renderOutreachText } from "./settings";
const ok = { ...D, calendarUrl: null };
it("accepts defaults", () => { expect(schema.safeParse(ok).success).toBe(true); });
it("requires the link placeholder in step texts", () => {
  expect(schema.safeParse({ ...ok, step0Text: "Salut" }).success).toBe(false);
  expect(schema.safeParse({ ...ok, step1Text: "Salut" }).success).toBe(false);
});
it("keeps step 1 inside the 24h window", () => { expect(schema.safeParse({ ...ok, step1DelayHours: 24 }).success).toBe(false); });
it("orders WhatsApp steps and send hours", () => {
  expect(schema.safeParse({ ...ok, step2DelayDays: 5, step3DelayDays: 5 }).success).toBe(false);
  expect(schema.safeParse({ ...ok, sendHourStart: 20, sendHourEnd: 20 }).success).toBe(false);
});
it("validates template names, language and https calendar", () => {
  expect(schema.safeParse({ ...ok, template1: "Bad Name" }).success).toBe(false);
  expect(schema.safeParse({ ...ok, templateLang: "french" }).success).toBe(false);
  expect(schema.safeParse({ ...ok, calendarUrl: "http://x.fr" }).success).toBe(false);
  expect(schema.safeParse({ ...ok, calendarUrl: "https://x.fr/demo" }).success).toBe(true);
});
it("is active only when enabled and not killed by env", () => {
  expect(outreachActive({ enabled: true }, {} as NodeJS.ProcessEnv)).toBe(true);
  expect(outreachActive({ enabled: true }, { OUTREACH_ENABLED: "false" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  expect(outreachActive({ enabled: false }, {} as NodeJS.ProcessEnv)).toBe(false);
});
it("renders placeholders", () => {
  expect(renderOutreachText("Hello {nom} {lien_demo} {nom}", { link: "https://l", name: "Léa" })).toBe("Hello Léa https://l Léa");
});
