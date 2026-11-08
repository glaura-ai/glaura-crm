import { describe, expect, it } from "vitest";
import { intersectDirectories, normalizeStreet, sameDirectoryBusiness } from "./directory-match";
const salon = { name: "Atelier Éclat", postalCode: "75011", street: "9 Boulevard Voltaire", sourceUrl: "https://www.treatwell.fr/salon/atelier-eclat/" };
describe("Treatwell and Planity intersection", () => {
  it("matches names and full addresses across accents, punctuation and abbreviations", () => {
    expect(sameDirectoryBusiness(salon, { ...salon, name: "Éclat - Paris 11", street: "9, Bd Voltaire, 75011 Paris" })).toBe(true);
    expect(normalizeStreet("12 bis Av. de la République, 75011 Paris")).toBe(normalizeStreet("12bis avenue de la Republique"));
  });
  it("rejects a different branch, postcode or an unrelated business at the same address", () => {
    expect(sameDirectoryBusiness(salon, { ...salon, street: "19 Boulevard Voltaire" })).toBe(false);
    expect(sameDirectoryBusiness(salon, { ...salon, postalCode: "75012" })).toBe(false);
    expect(sameDirectoryBusiness(salon, { ...salon, name: "Institut Rosalie" })).toBe(false);
  });
  it("does not treat missing addresses as proof of both platforms", () => {
    expect(sameDirectoryBusiness(salon, { ...salon, street: null })).toBe(false);
    expect(sameDirectoryBusiness({ ...salon, street: "Boulevard Voltaire" }, { ...salon, street: "Boulevard Voltaire" })).toBe(false);
  });
  it("imports the intersection instead of the union", () => {
    const planity = { ...salon, sourceUrl: "https://www.planity.com/atelier-eclat-75011-paris" };
    const result = intersectDirectories([salon, { ...salon, name: "Autre salon", street: "11 rue Oberkampf" }], [planity]);
    expect(result.pairs).toEqual([{ treatwell: salon, planity }]);
    expect(result.unmatched).toBe(1);
  });
  it("leaves ambiguous many-to-one and one-to-many matches unconfirmed", () => {
    const planity = { ...salon, sourceUrl: "https://www.planity.com/atelier-eclat" };
    expect(intersectDirectories([salon], [planity, { ...planity, sourceUrl: "https://www.planity.com/atelier-eclat-bis" }]).pairs).toHaveLength(0);
    const result = intersectDirectories([salon, { ...salon, sourceUrl: "https://www.treatwell.fr/salon/eclat-bis/" }], [planity]);
    expect(result.pairs).toHaveLength(0);
    expect(result.ambiguous).toBe(2);
  });
});
