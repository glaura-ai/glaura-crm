import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), save: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/access", () => ({ requireInstagramAdmin: mocks.admin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("./settings", async () => ({ ...(await vi.importActual<object>("./settings")), getOutreachSettings: mocks.get, saveOutreachSettings: mocks.save }));
import { DEFAULT_OUTREACH_SETTINGS as D } from "./settings";
import { saveAutomationSettings, toggleAutomation } from "./settings-actions";
const form = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  const base: Record<string, string> = { enabled: "true", autoStart: "on", step0Text: D.step0Text, step1Text: D.step1Text, askPhoneText: D.askPhoneText, step1DelayHours: "20", step2DelayDays: "2", step3DelayDays: "5", sendHourStart: "9", sendHourEnd: "20", template1: "t_one", template2: "t_two", templateLang: "fr", calendarUrl: "", ...over };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
};
beforeEach(() => { vi.resetAllMocks(); mocks.admin.mockResolvedValue({ id: "u1" }); });
it("saves valid settings and redirects with saved=1", async () => {
  await expect(saveAutomationSettings(form())).rejects.toThrow("/automatisations?saved=1");
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, autoStart: true, step1DelayHours: 20, template1: "t_one", calendarUrl: null }), "u1");
});
it("redirects with the first issue on invalid input", async () => {
  await expect(saveAutomationSettings(form({ step0Text: "Salut" }))).rejects.toThrow("/automatisations?error=" + encodeURIComponent("Le premier message doit contenir {lien_demo}."));
  expect(mocks.save).not.toHaveBeenCalled();
});
it("toggle flips only enabled", async () => {
  mocks.get.mockResolvedValue({ ...D, enabled: false, autoStart: true });
  await expect(toggleAutomation()).rejects.toThrow("/automatisations");
  expect(mocks.save).toHaveBeenCalledWith({ ...D, enabled: true, autoStart: true }, "u1");
});
