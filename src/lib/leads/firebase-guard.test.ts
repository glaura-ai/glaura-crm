import { describe, expect, it, vi } from "vitest";
import { findLinkedFirebaseAccounts, salonDeleteBlocker } from "./firebase-guard";

type FakeUser = { uid: string; email?: string; disabled: boolean };

function fakeAuth(users: FakeUser[]) {
  return {
    getUser: vi.fn(async (uid: string) => {
      const u = users.find((x) => x.uid === uid);
      if (!u) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
      return u;
    }),
    getUserByEmail: vi.fn(async (email: string) => {
      const u = users.find((x) => x.email === email);
      if (!u) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
      return u;
    }),
  };
}

describe("findLinkedFirebaseAccounts", () => {
  it("returns nothing when the lead has no uid nor email", async () => {
    const auth = fakeAuth([]);
    expect(await findLinkedFirebaseAccounts({ uids: [], emails: [] }, auth)).toEqual([]);
  });

  it("finds accounts by onboarding uid and by contact email, deduped", async () => {
    const auth = fakeAuth([
      { uid: "u1", email: "a@x.fr", disabled: true },
      { uid: "u2", email: "b@x.fr", disabled: false },
    ]);
    const found = await findLinkedFirebaseAccounts({ uids: ["u1", null], emails: [" A@x.fr ", "b@x.fr", "none@x.fr"] }, auth);
    expect(found).toEqual([
      { uid: "u1", email: "a@x.fr", disabled: true },
      { uid: "u2", email: "b@x.fr", disabled: false },
    ]);
  });

  it("ignores a uid whose Firebase account was already deleted", async () => {
    const auth = fakeAuth([]);
    expect(await findLinkedFirebaseAccounts({ uids: ["gone"], emails: [] }, auth)).toEqual([]);
  });

  it("propagates unexpected Firebase errors instead of treating them as 'no account'", async () => {
    const auth = { getUser: vi.fn(async () => { throw new Error("network down"); }), getUserByEmail: vi.fn() };
    await expect(findLinkedFirebaseAccounts({ uids: ["u1"], emails: [] }, auth)).rejects.toThrow("network down");
  });
});

describe("salonDeleteBlocker", () => {
  it("allows deletion without a Firebase account", () => {
    expect(salonDeleteBlocker([], "Salon", undefined)).toBeNull();
  });

  it("blocks while any linked account is still enabled", () => {
    expect(salonDeleteBlocker([{ uid: "u", email: "a@x.fr", disabled: false }], "Salon", "Salon")).toMatch(/désactive/);
  });

  it("requires the typed salon name when the account is disabled", () => {
    const accounts = [{ uid: "u", email: "a@x.fr", disabled: true }];
    expect(salonDeleteBlocker(accounts, "Le Salon", undefined)).toMatch(/confirm/i);
    expect(salonDeleteBlocker(accounts, "Le Salon", "le salon ")).toBeNull();
  });
});
