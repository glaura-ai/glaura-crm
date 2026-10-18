import { describe, expect, it } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const SECRET = "test-secret-0123456789";

describe("unsubscribe token", () => {
  it("round-trips a provider id", () => {
    const token = signUnsubscribeToken("uid_123", SECRET);
    expect(token.startsWith("uid_123.")).toBe(true);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe("uid_123");
  });

  it("rejects a tampered signature", () => {
    const token = signUnsubscribeToken("uid_123", SECRET);
    expect(verifyUnsubscribeToken(token.slice(0, -2) + "xx", SECRET)).toBeNull();
  });

  it("rejects a swapped provider id", () => {
    const sig = signUnsubscribeToken("uid_123", SECRET).split(".")[1];
    expect(verifyUnsubscribeToken(`uid_other.${sig}`, SECRET)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken("uid_123", "other-secret"), SECRET)).toBeNull();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "nodot", ".sig", "uid.", "a.b.c"]) {
      expect(verifyUnsubscribeToken(bad, SECRET)).toBeNull();
    }
  });

  it("refuses to sign or verify without a secret", () => {
    expect(() => signUnsubscribeToken("uid", "")).toThrow();
    expect(verifyUnsubscribeToken("uid.sig", "")).toBeNull();
  });
});
