import { describe, expect, it } from "vitest";
import { selectRecipients, type ProfileDoc } from "./recipients";

const doc = (id: string, data: Record<string, unknown>): ProfileDoc => ({ id, data });

describe("selectRecipients", () => {
  it("keeps salons (userRole 2) with a valid email", () => {
    const out = selectRecipients([
      doc("a", { userRole: 2, email: "Salon@Example.com", companyName: "Chez A" }),
    ]);
    expect(out).toEqual([{ providerId: "a", email: "salon@example.com", salonName: "Chez A" }]);
  });

  it("drops customers and other roles", () => {
    expect(
      selectRecipients([doc("a", { userRole: 0, email: "a@x.fr" }), doc("b", { email: "b@x.fr" })]),
    ).toEqual([]);
  });

  it("drops missing or invalid emails", () => {
    expect(
      selectRecipients([doc("a", { userRole: 2 }), doc("b", { userRole: 2, email: "not-an-email" })]),
    ).toEqual([]);
  });

  it("drops opted-out salons", () => {
    const out = selectRecipients([
      doc("a", { userRole: 2, email: "a@x.fr", featureAnnouncements: { emailOptOut: true } }),
      doc("b", { userRole: 2, email: "b@x.fr", featureAnnouncements: { seen: {} } }),
    ]);
    expect(out.map((r) => r.providerId)).toEqual(["b"]);
  });

  it("drops @glaura.fr placeholder emails", () => {
    expect(selectRecipients([doc("a", { userRole: 2, email: "salon123@glaura.fr" })])).toEqual([]);
  });

  it("falls back to a neutral salon name", () => {
    const [r] = selectRecipients([doc("a", { userRole: 2, email: "a@x.fr" })]);
    expect(r.salonName).toBe("");
  });

  it("dedupes by email", () => {
    const out = selectRecipients([
      doc("a", { userRole: 2, email: "a@x.fr" }),
      doc("b", { userRole: 2, email: "A@x.fr" }),
    ]);
    expect(out).toHaveLength(1);
  });
});
