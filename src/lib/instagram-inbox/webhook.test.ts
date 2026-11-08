import { createHmac } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock("./store", () => ({ storeInstagramMessage: state.store }));
import { GET, POST } from "@/app/api/instagram/webhook/route";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("META_APP_SECRET", "secret"); vi.stubEnv("IG_GRAPH_USER_ID", "glaura-ig"); vi.stubEnv("IG_WEBHOOK_VERIFY_TOKEN", "verify"); });
function request(entries: unknown[]) {
  const body = JSON.stringify({ object: "instagram", entry: entries });
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  return new Request("https://crm.example/api/instagram/webhook", { method: "POST", body, headers: { "x-hub-signature-256": signature } });
}
it("verifies the subscription challenge", async () => {
  const response = await GET(new Request("https://crm.example/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=challenge"));
  expect(await response.text()).toBe("challenge");
  expect((await GET(new Request("https://crm.example/api/instagram/webhook?hub.verify_token=wrong"))).status).toBe(403);
});
it("rejects forged payloads before saving anything", async () => {
  expect((await POST(new Request("https://crm.example/api/instagram/webhook", { method: "POST", body: "{}" }))).status).toBe(403);
  expect(state.store).not.toHaveBeenCalled();
});
it("ignores other Instagram accounts even with an authentic Meta signature", async () => {
  expect((await POST(request([{ id: "other-account", messaging: [{ sender: { id: "customer" }, recipient: { id: "other-account" }, timestamp: Date.now(), message: { mid: "m1", text: "Private" } }] }]))).status).toBe(200);
  expect(state.store).not.toHaveBeenCalled();
});
it("keeps incoming and outgoing messages in the same participant thread", async () => {
  const time = Date.now();
  const events = [{ sender: { id: "customer" }, recipient: { id: "glaura-ig" }, timestamp: time, message: { mid: "m1", text: "Bonjour" } }, { sender: { id: "glaura-ig" }, recipient: { id: "customer" }, timestamp: time + 1, message: { mid: "m2", is_echo: true, text: "Bonjour !" } }];
  expect((await POST(request([{ id: "glaura-ig", messaging: events }]))).status).toBe(200);
  expect(state.store.mock.calls[0][1]).toMatchObject({ participantId: "customer", incoming: true, text: "Bonjour" });
  expect(state.store.mock.calls[1][1]).toMatchObject({ participantId: "customer", incoming: false, text: "Bonjour !" });
});
it("returns a retryable status if storage fails", async () => {
  state.store.mockRejectedValueOnce(new Error("DB unavailable"));
  const response = await POST(request([{ id: "glaura-ig", messaging: [{ sender: { id: "customer" }, recipient: { id: "glaura-ig" }, timestamp: Date.now(), message: { mid: "m1", text: "Bonjour" } }] }]));
  expect(response.status).toBe(503);
});
