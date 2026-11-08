import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ profile: vi.fn(), vault: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({ getDb: () => ({ collection: (name: string) => ({ doc: () => ({ get: name === "instagramCredentials" ? state.vault : state.profile }) }) }) }));
import { inboxConfig, metaRequest } from "./client";
beforeEach(() => {
  vi.stubEnv("CRM_INSTAGRAM_PROVIDER_ID", "glaura-provider");
  state.profile.mockResolvedValue({ exists: true, data: () => ({ instagramConnected: true, instagramUsername: "glaura.app", instagramUserId: "ig-id" }) });
  state.vault.mockResolvedValue({ exists: true, data: () => ({ accessToken: "private-vault-token", instagramUserId: "ig-id" }) });
  state.fetch.mockReset(); vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("reuses the Glaura provider’s managed Instagram Login token and host", async () => {
  const config = await inboxConfig();
  expect(config).toMatchObject({ accountId: "ig-id", token: "private-vault-token", host: "graph.instagram.com" });
});
it("refuses to expose another salon’s connection through the CRM", async () => {
  state.profile.mockResolvedValue({ exists: true, data: () => ({ instagramConnected: true, instagramUsername: "other.salon" }) });
  expect(await inboxConfig()).toBeNull();
});
it("rejects disconnected or managed-placeholder-only credentials", async () => {
  state.vault.mockResolvedValue({ data: () => ({ accessToken: "__managed__" }) });
  expect(await inboxConfig()).toBeNull();
});
it("reads renewed credentials from the vault rather than caching an old token", async () => {
  expect((await inboxConfig())?.token).toBe("private-vault-token");
  state.vault.mockResolvedValue({ data: () => ({ accessToken: "renewed-token" }) });
  expect((await inboxConfig())?.token).toBe("renewed-token");
});
it("uses authorization headers on Instagram Graph and never puts tokens in URLs", async () => {
  state.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  await metaRequest("ig-id/conversations?platform=instagram");
  expect(state.fetch.mock.calls[0][0].hostname).toBe("graph.instagram.com");
  expect(state.fetch.mock.calls[0][0].href).not.toContain("private-vault-token");
  expect(state.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer private-vault-token");
});
