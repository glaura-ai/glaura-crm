import { expect, it } from "vitest";
import { extractFrenchMobile } from "./phone";

it("normalises the usual French mobile spellings to E.164", () => {
  for (const t of ["06 12 34 56 78", "07.12.34.56.78", "06-12-34-56-78", "0612345678", "+33 6 12 34 56 78", "+33612345678", "0033 6 12 34 56 78", "+33 (0)6 12 34 56 78", "Mon numéro : 06 12 34 56 78 merci"])
    expect(extractFrenchMobile([t])).toMatch(/^\+33[67]\d{8}$/);
  expect(extractFrenchMobile(["06 12 34 56 78"])).toBe("+33612345678");
  expect(extractFrenchMobile(["+33 7 12 34 56 78"])).toBe("+33712345678");
});
it("ignores landlines, foreign and too-short or too-long numbers", () => {
  for (const t of ["01 42 71 23 99", "+33 1 42 71 23 99", "+44 7911 123456", "06 12 34", "06 12 34 56 78 90", "réf 123456789012", "rdv à 10h30"])
    expect(extractFrenchMobile([t])).toBeNull();
});
it("takes the latest message, then the latest number in it", () => {
  expect(extractFrenchMobile(["06 11 11 11 11", "ok", "plutôt le 07 22 22 22 22"])).toBe("+33722222222");
  expect(extractFrenchMobile(["06 11 11 11 11 ou 06 33 33 33 33"])).toBe("+33633333333");
  expect(extractFrenchMobile(["06 11 11 11 11", "merci"])).toBe("+33611111111");
});
it("returns null without input", () => {
  expect(extractFrenchMobile([])).toBeNull();
});
