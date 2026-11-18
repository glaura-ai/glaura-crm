import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), doc: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({ getDb: () => ({ collection: (c: string) => ({ doc: (id: string) => { mocks.doc(c, id); return { get: mocks.get }; } }) }) }));
import { isWhatsappOptedOut, sendOutreachTemplate } from "./whatsapp";
const env = { META_SYSTEM_USER_TOKEN: "tok-secret", WHATSAPP_OUTREACH_PHONE_NUMBER_ID: "123", META_APP_SECRET: "app-secret" };
beforeEach(() => { vi.clearAllMocks(); for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("posts the template with bearer token, appsecret_proof and the salon name", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.1" }] }) });
  vi.stubGlobal("fetch", fetchMock);
  expect(await sendOutreachTemplate({ to: "+33612345678", template: "t1", language: "fr", displayName: "Studio Léa" })).toBe("wamid.1");
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("graph.facebook.com/v23.0/123/messages");
  expect(new URL(url).searchParams.get("appsecret_proof")).toBe(createHmac("sha256", "app-secret").update("tok-secret").digest("hex"));
  expect(init.headers.Authorization).toBe("Bearer tok-secret");
  expect(init.redirect).toBe("error");
  expect(JSON.parse(init.body)).toEqual({ messaging_product: "whatsapp", to: "33612345678", type: "template", template: { name: "t1", language: { code: "fr" }, components: [{ type: "body", parameters: [{ type: "text", text: "Studio Léa" }] }] } });
});
it("adds the dynamic URL button parameter", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "w" }] }) });
  vi.stubGlobal("fetch", fetchMock);
  await sendOutreachTemplate({ to: "+33612345678", template: "t1", language: "fr", displayName: "x", buttonParam: "tok" });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).template.components[1]).toEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "tok" }] });
});
it("uses the given template language", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "w" }] }) });
  vi.stubGlobal("fetch", fetchMock);
  await sendOutreachTemplate({ to: "+33612345678", template: "t2", language: "en_GB", displayName: "x" });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).template).toMatchObject({ name: "t2", language: { code: "en_GB" } });
});
it("omits appsecret_proof without META_APP_SECRET", async () => {
  vi.stubEnv("META_APP_SECRET", "");
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "w" }] }) });
  vi.stubGlobal("fetch", fetchMock);
  await sendOutreachTemplate({ to: "+33612345678", template: "t1", language: "fr", displayName: "x" });
  expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has("appsecret_proof")).toBe(false);
});
it("fails without leaking the token, on HTTP error and on missing config", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "tok-secret" }) }));
  const err = await sendOutreachTemplate({ to: "+33612345678", template: "t1", language: "fr", displayName: "x" }).catch(e => e as Error);
  expect((err as Error).message).toContain("400"); expect((err as Error).message).not.toContain("tok-secret");
  vi.stubEnv("META_SYSTEM_USER_TOKEN", "");
  await expect(sendOutreachTemplate({ to: "+33612345678", template: "t1", language: "fr", displayName: "x" })).rejects.toThrow("pas configurée");
});
it("reads opt-outs from Firestore whatsappOptOuts/{E.164}", async () => {
  mocks.get.mockResolvedValueOnce({ exists: true }).mockResolvedValueOnce({ exists: false });
  expect(await isWhatsappOptedOut("+33612345678")).toBe(true);
  expect(mocks.doc).toHaveBeenCalledWith("whatsappOptOuts", "+33612345678");
  expect(await isWhatsappOptedOut("+33612345678")).toBe(false);
});
