import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ seqFind: vi.fn(), seqUpdate: vi.fn(), userFind: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { outreachSequence: { findUnique: m.seqFind, update: m.seqUpdate }, user: { findUnique: m.userFind } } }));
vi.mock("./settings", async orig => ({ ...await orig<typeof import("./settings")>(), getOutreachSettings: m.settings }));
import { recordClickAndResolve, resolveBookingUrl, trackedLink } from "./booking";
import { DEFAULT_OUTREACH_SETTINGS } from "./settings";

const T = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const DEF = "https://cal.test/default";
const settings = { calendarUrl: DEF };
const u = (bookingUrl: string | null, active = true) => ({ bookingUrl, active });
const seq = (assigned: ReturnType<typeof u> | null, startedBy: ReturnType<typeof u> | null) => ({ conversation: { salon: { assignedTo: assigned } }, startedBy });

beforeEach(() => {
  vi.clearAllMocks();
  m.settings.mockResolvedValue({ ...DEFAULT_OUTREACH_SETTINGS, calendarUrl: DEF });
});

it("builds the tracked link from CRM_PUBLIC_URL, trimming slashes, with a default", () => {
  expect(trackedLink(T, {})).toBe(`https://crm.glaura.ai/demo/${T}`);
  expect(trackedLink(T, { CRM_PUBLIC_URL: "https://x.test//" })).toBe(`https://x.test/demo/${T}`);
});
it("prefers the assigned salesperson, then the starter, then the default", () => {
  expect(resolveBookingUrl(seq(u("https://a"), u("https://b")), settings)).toBe("https://a");
  expect(resolveBookingUrl(seq(u(null), u("https://b")), settings)).toBe("https://b");
  expect(resolveBookingUrl(seq(null, u("https://b")), settings)).toBe("https://b");
  expect(resolveBookingUrl(seq(null, null), settings)).toBe(DEF);
});
it("ignores inactive users", () => {
  expect(resolveBookingUrl(seq(u("https://a", false), u("https://b")), settings)).toBe("https://b");
  expect(resolveBookingUrl(seq(u("https://a", false), u("https://b", false)), settings)).toBe(DEF);
});
it("returns the default without any DB write for an invalid or unknown token", async () => {
  expect(await recordClickAndResolve("nope")).toBe(DEF);
  m.seqFind.mockResolvedValue(null);
  expect(await recordClickAndResolve(T)).toBe(DEF);
  expect(m.seqUpdate).not.toHaveBeenCalled();
});
it("counts the click and resolves the salesperson's calendar", async () => {
  m.seqFind.mockResolvedValue({ startedById: "u2", conversation: { salon: { assignedTo: u("https://a") } } });
  m.userFind.mockResolvedValue(u("https://b"));
  expect(await recordClickAndResolve(T)).toBe("https://a");
  expect(m.seqUpdate).toHaveBeenCalledWith({ where: { linkToken: T }, data: { linkClicks: { increment: 1 }, linkClickedAt: expect.any(Date) } });
});
it("falls back to the default when the target is not https", async () => {
  m.seqFind.mockResolvedValue({ startedById: null, conversation: { salon: { assignedTo: u("http://insecure") } } });
  expect(await recordClickAndResolve(T)).toBe(DEF);
});

describe("isPreviewBot", () => {
  it("skips link-preview fetchers but counts real browsers", async () => {
    const { isPreviewBot } = await import("./booking");
    expect(isPreviewBot("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe(true);
    expect(isPreviewBot("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(isPreviewBot(null)).toBe(true);
    expect(isPreviewBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0")).toBe(false);
    expect(isPreviewBot("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36")).toBe(false);
  });
});
