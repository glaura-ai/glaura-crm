import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";
const state = vi.hoisted(() => ({ config: null as NextAuthConfig | null, find: vi.fn(), upsert: vi.fn() }));
vi.mock("next-auth", () => ({ default: (config: NextAuthConfig) => { state.config = config; return {}; } }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: state.find, upsert: state.upsert } } }));
import "./auth";
beforeEach(() => vi.clearAllMocks());
describe("session revocation", () => {
  it("revokes a previously valid JWT when the member is disabled", async () => {
    state.find.mockResolvedValue({ active: false, role: "ADMIN" });
    const result = await state.config!.callbacks!.jwt!({ token: { uid: "former", role: "ADMIN" } } as never);
    expect(result).toBeNull();
  });
  it("revokes tokens whose member has been removed", async () => {
    state.find.mockResolvedValue(null);
    expect(await state.config!.callbacks!.jwt!({ token: { uid: "removed" } } as never)).toBeNull();
  });
  it("refreshes role changes instead of trusting an old admin JWT", async () => {
    state.find.mockResolvedValue({ active: true, role: "COMMERCIAL", email: "sales@glaura.fr", accessGrantedAt: new Date() });
    expect(await state.config!.callbacks!.jwt!({ token: { uid: "rep", role: "ADMIN" } } as never)).toEqual({ uid: "rep", role: "COMMERCIAL" });
  });
  it("does not grant Google access just because a historical user row is active", async () => {
    state.find.mockResolvedValue({ active: true, email: "former@outside.example", accessGrantedAt: null });
    expect(await state.config!.callbacks!.signIn!({ user: { email: "former@outside.example" }, profile: { email_verified: true }, account: { provider: "google" } } as never)).toBe(false);
  });
  it("accepts an explicitly approved Google member", async () => {
    state.find.mockResolvedValue({ active: true, accessGrantedAt: new Date() });
    expect(await state.config!.callbacks!.signIn!({ user: { email: "new@glaura.fr" }, profile: { email_verified: true }, account: { provider: "google" } } as never)).toBe(true);
  });
  it("refuses an explicitly disabled member even when they had approval", async () => {
    state.find.mockResolvedValue({ active: false, accessGrantedAt: new Date() });
    expect(await state.config!.callbacks!.signIn!({ user: { email: "former@glaura.fr" }, profile: { email_verified: true }, account: { provider: "google" } } as never)).toBe(false);
  });
});
