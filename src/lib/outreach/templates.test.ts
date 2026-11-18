import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchTemplateStatuses } from "./templates";
const env = { META_SYSTEM_USER_TOKEN: "tok-secret", WHATSAPP_OUTREACH_PHONE_NUMBER_ID: "123", WHATSAPP_OUTREACH_WABA_ID: "waba9", META_APP_SECRET: "app-secret" };
beforeEach(() => { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const ok = (data: unknown) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data }) });

it("calls the WABA templates endpoint with bearer token and appsecret_proof, and maps statuses", async () => {
  const fetchMock = ok([{ name: "a", status: "APPROVED" }, { name: "b", status: "REJECTED" }, { name: "other", status: "PENDING" }]);
  vi.stubGlobal("fetch", fetchMock);
  expect(await fetchTemplateStatuses(["a", "b", "c"])).toEqual({ a: "APPROVED", b: "REJECTED", c: "MISSING" });
  const [url, init] = fetchMock.mock.calls[0];
  const u = new URL(url);
  expect(u.pathname).toBe("/v23.0/waba9/message_templates");
  expect(u.searchParams.get("fields")).toBe("name,status"); expect(u.searchParams.get("limit")).toBe("200");
  expect(u.searchParams.get("appsecret_proof")).toBe(createHmac("sha256", "app-secret").update("tok-secret").digest("hex"));
  expect(init.headers.Authorization).toBe("Bearer tok-secret"); expect(init.cache).toBe("no-store");
});
it("keeps the best status across languages", async () => {
  vi.stubGlobal("fetch", ok([{ name: "a", status: "REJECTED" }, { name: "a", status: "APPROVED" }]));
  expect(await fetchTemplateStatuses(["a"])).toEqual({ a: "APPROVED" });
});
it("returns null when not configured, on HTTP error, on network error and on bad payload", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("WHATSAPP_OUTREACH_WABA_ID", ""); expect(await fetchTemplateStatuses(["a"])).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  vi.stubEnv("WHATSAPP_OUTREACH_WABA_ID", "waba9");
  fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }); expect(await fetchTemplateStatuses(["a"])).toBeNull();
  fetchMock.mockRejectedValueOnce(new Error("tok-secret boom")); expect(await fetchTemplateStatuses(["a"])).toBeNull();
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("bad"); } }); expect(await fetchTemplateStatuses(["a"])).toBeNull();
});
