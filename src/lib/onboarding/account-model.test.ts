import { describe, expect, it } from "vitest";

describe("uniqueServiceNames", () => {
  it("keeps unique names and suffixes repeats with their section, then a number", async () => {
    const { uniqueServiceNames } = await import("./account-model");
    expect(uniqueServiceNames([
      { service_name: "Pose mixte", subcategory_name: "Mains" },
      { service_name: "Pose mixte", subcategory_name: "Pieds" },
      { service_name: "Remplissage", subcategory_name: "Gel" },
      { service_name: "Remplissage", subcategory_name: "Gel" },
      { service_name: "Dépose", subcategory_name: "" },
    ])).toEqual(["Pose mixte – Mains", "Pose mixte – Pieds", "Remplissage – Gel", "Remplissage (2)", "Dépose"]);
  });
});
