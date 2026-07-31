import { describe, expect, it } from "vitest";

import { normalizeInstagramHandle } from "./instagram";

describe("normalizeInstagramHandle", () => {
  it("keeps a bare handle as-is", () => {
    expect(normalizeInstagramHandle("gg_pyvaline")).toBe("gg_pyvaline");
    expect(normalizeInstagramHandle("zazen.paris")).toBe("zazen.paris");
  });

  it("strips the @ a salon types in front of its handle", () => {
    expect(normalizeInstagramHandle("@gg_pyvaline")).toBe("gg_pyvaline");
    expect(normalizeInstagramHandle("  @gg_pyvaline  ")).toBe("gg_pyvaline");
    // Already-broken data being re-saved must not keep stacking @.
    expect(normalizeInstagramHandle("@@gg_pyvaline")).toBe("gg_pyvaline");
  });

  it("pulls the handle out of a pasted profile URL", () => {
    expect(normalizeInstagramHandle("https://www.instagram.com/zazen.paris")).toBe("zazen.paris");
    expect(normalizeInstagramHandle("https://instagram.com/zazen.paris/")).toBe("zazen.paris");
    expect(normalizeInstagramHandle("instagram.com/zazen.paris?hl=fr")).toBe("zazen.paris");
    expect(normalizeInstagramHandle("www.instagram.com/@zazen.paris")).toBe("zazen.paris");
  });

  it("lowercases, since handles are case-insensitive and we search on them", () => {
    expect(normalizeInstagramHandle("ZaZen.Paris")).toBe("zazen.paris");
  });

  it("returns null for nothing at all", () => {
    expect(normalizeInstagramHandle(null)).toBeNull();
    expect(normalizeInstagramHandle(undefined)).toBeNull();
    expect(normalizeInstagramHandle("")).toBeNull();
    expect(normalizeInstagramHandle("   ")).toBeNull();
    expect(normalizeInstagramHandle("@")).toBeNull();
    expect(normalizeInstagramHandle("https://www.instagram.com/")).toBeNull();
  });

  it("recovers the salon from a story URL, but not from a post or reel", () => {
    expect(normalizeInstagramHandle("https://www.instagram.com/stories/zazen.paris/123456")).toBe(
      "zazen.paris",
    );
    expect(normalizeInstagramHandle("https://www.instagram.com/p/Cx1y2z3/")).toBeNull();
    expect(normalizeInstagramHandle("https://www.instagram.com/reel/Cx1y2z3/")).toBeNull();
  });

  it("rejects anything that cannot be an Instagram handle", () => {
    // Free text typed into the field — a dead @link is worse than no link.
    expect(normalizeInstagramHandle("pas d'instagram")).toBeNull();
    expect(normalizeInstagramHandle("https://facebook.com/zazen.paris")).toBeNull();
    expect(normalizeInstagramHandle("a".repeat(31))).toBeNull();
  });
});
