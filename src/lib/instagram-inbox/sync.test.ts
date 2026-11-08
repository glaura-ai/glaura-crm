import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ config: vi.fn(), request: vi.fn(), store: vi.fn() }));
vi.mock("./client", () => ({ inboxConfig: state.config, metaRequest: state.request }));
vi.mock("./store", () => ({ storeInstagramMessage: state.store }));
import { syncInstagramHistory } from "./sync";
beforeEach(() => { vi.clearAllMocks(); state.config.mockResolvedValue({ token: "private", accountId: "owner-asuid", ownerIds: ["owner-asuid", "owner-business"], username: "glaura.app", host: "graph.instagram.com", version: "v23.0" }); });
it("keeps owner aliases out of the participant selection and correctly imports both directions", async () => {
  state.request.mockResolvedValueOnce({ data: [{ id: "conversation", participants: { data: [{ id: "owner-business", username: "glaura.app" }, { id: "customer", username: "salon" }] } }] });
  state.request.mockResolvedValueOnce({ data: [{ id: "m1", message: "Bonjour", created_time: "2026-11-08T10:00:00Z", from: { id: "customer" } }, { id: "m2", message: "Bonjour !", created_time: "2026-11-08T10:01:00Z", from: { id: "owner-business", username: "glaura.app" } }] });
  expect(await syncInstagramHistory()).toEqual({ conversations: 1, messages: 2 });
  expect(state.store.mock.calls[0][1]).toMatchObject({ participantId: "customer", incoming: true });
  expect(state.store.mock.calls[1][1]).toMatchObject({ participantId: "customer", incoming: false });
});
it("does not attempt requests without an authorized connection", async () => {
  state.config.mockResolvedValue(null);
  await expect(syncInstagramHistory()).rejects.toThrow("configurée");
  expect(state.request).not.toHaveBeenCalled();
});
