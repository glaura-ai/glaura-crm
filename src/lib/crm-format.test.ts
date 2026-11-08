import { describe, expect, it } from "vitest";
import { parisDateInput, parisDeadline } from "./crm-format";
describe("French deadlines", () => {
  it("uses the Paris calendar date around UTC midnight", () => {
    expect(parisDateInput(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-09");
  });
  it("keeps 18:00 Paris deadlines through summer and winter", () => {
    expect(parisDeadline("2026-11-08").toISOString()).toBe("2026-11-08T17:00:00.000Z");
    expect(parisDeadline("2026-07-08").toISOString()).toBe("2026-07-08T16:00:00.000Z");
  });
  it("rejects invalid and normalized dates", () => {
    expect(() => parisDeadline("2026-02-30")).toThrow();
    expect(() => parisDeadline("nonsense")).toThrow();
  });
});
