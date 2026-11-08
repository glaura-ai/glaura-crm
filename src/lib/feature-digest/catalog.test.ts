import { describe, expect, it } from "vitest";
import { catalogSchema, pickFeatures } from "./catalog";

const f = (id: string) => ({
  id, publishedAt: "2026-10-01", titleFr: "t", titleEn: "t", benefitFr: "b", benefitEn: "b",
  hintFr: "h", hintEn: "h", href: "/x", emailImage: "https://images.glaura.ai/a.gif",
});

describe("catalog", () => {
  it("validates the portal contract", () => {
    expect(catalogSchema.safeParse({ version: 1, features: [f("a")] }).success).toBe(true);
    expect(catalogSchema.safeParse({ version: 2, features: [f("a")] }).success).toBe(false);
    expect(catalogSchema.safeParse({ version: 1, features: [{ id: "a" }] }).success).toBe(false);
  });

  it("requires emailImage on https images.glaura.ai", () => {
    for (const bad of ["http://images.glaura.ai/a.gif", "https://evil.example/a.gif", "https://images.glaura.ai.evil.com/a.gif"]) {
      expect(catalogSchema.safeParse({ version: 1, features: [{ ...f("a"), emailImage: bad }] }).success).toBe(false);
    }
  });

  it("picks features in the requested order, max 3, all must exist", () => {
    const cat = catalogSchema.parse({ version: 1, features: [f("a"), f("b"), f("c"), f("d")] });
    expect(pickFeatures(cat, ["c", "a"]).map((x) => x.id)).toEqual(["c", "a"]);
    expect(() => pickFeatures(cat, ["a", "b", "c", "d"])).toThrow(/3/);
    expect(() => pickFeatures(cat, [])).toThrow();
    expect(() => pickFeatures(cat, ["zz"])).toThrow(/zz/);
  });
});
