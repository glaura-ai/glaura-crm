import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("REDIRECT_LOGIN"); } }));
import { canAccessInstagram, prospectScope, requireAdmin, requireInstagramAdmin, requireMember } from "./access";

beforeEach(() => { vi.unstubAllEnvs(); mocks.auth.mockReset(); });
describe("CRM access boundaries", () => {
  it("rejects anonymous requests", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(requireMember()).rejects.toThrow("REDIRECT_LOGIN");
  });
  it("rejects sales accounts for both administration and the inbox", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "sales", role: "COMMERCIAL", email: "sales@glaura.fr" } });
    await expect(requireAdmin()).rejects.toThrow("administration");
    await expect(requireInstagramAdmin()).rejects.toThrow("administration");
  });
  it("keeps the inbox private even from other administrators", async () => {
    vi.stubEnv("CRM_INSTAGRAM_ADMIN_EMAIL", "owner@glaura.fr");
    mocks.auth.mockResolvedValue({ user: { id: "other", role: "ADMIN", email: "other@glaura.fr" } });
    await expect(requireInstagramAdmin()).rejects.toThrow("privée");
    expect(canAccessInstagram({ role: "ADMIN", email: "OWNER@glaura.fr" })).toBe(true);
    expect(canAccessInstagram({ role: "COMMERCIAL", email: "owner@glaura.fr" })).toBe(false);
  });
  it("scopes sales to direct assignments and legacy rounds without overriding a new owner", () => {
    expect(prospectScope({ id: "rep", role: "COMMERCIAL" })).toEqual({ OR: [{ assignedToId: "rep" }, { assignedToId: null, tournee: { assignedToId: "rep" } }] });
    expect(prospectScope({ id: "admin", role: "ADMIN" })).toEqual({});
  });
});
