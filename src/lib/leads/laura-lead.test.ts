import { describe, expect, it } from "vitest";

import {
  detectBookingTool,
  externalRefFor,
  isBearerAuthorized,
  lauraLeadSchema,
  notesFor,
  salonNameFor,
} from "./laura-lead";

describe("lauraLeadSchema", () => {
  it("requires the two fields a callback cannot happen without", () => {
    expect(lauraLeadSchema.safeParse({ phone: "0612345678" }).success).toBe(false);
    expect(lauraLeadSchema.safeParse({ name: "Camille" }).success).toBe(false);
    expect(lauraLeadSchema.safeParse({ name: "Camille", phone: "0612345678" }).success).toBe(true);
  });

  it("accepts a lead with no booking link — it is optional on the form", () => {
    const parsed = lauraLeadSchema.parse({ name: "Camille", phone: "06 12 34 56 78" });
    expect(parsed.bookingLink).toBeUndefined();
  });

  it("stores a bare Instagram handle whatever the salon typed", () => {
    const typed = lauraLeadSchema.parse({ name: "C", phone: "06", instagram: "@gg_pyvaline" });
    expect(typed.instagram).toBe("gg_pyvaline");

    const pasted = lauraLeadSchema.parse({
      name: "C",
      phone: "06",
      instagram: "https://www.instagram.com/zazen.paris/?hl=fr",
    });
    expect(pasted.instagram).toBe("zazen.paris");
  });

  it("keeps the lead when the Instagram field is unusable — the callback matters more", () => {
    const parsed = lauraLeadSchema.parse({ name: "C", phone: "06", instagram: "je n'en ai pas" });
    expect(parsed.instagram).toBeNull();
  });

  it("rejects a malformed email rather than storing junk", () => {
    expect(
      lauraLeadSchema.safeParse({ name: "C", phone: "06", email: "not-an-email" }).success,
    ).toBe(false);
  });
});

describe("detectBookingTool", () => {
  it("recognises each tool we integrate with", () => {
    expect(detectBookingTool("https://www.planity.com/studio")).toBe("PLANITY");
    expect(detectBookingTool("https://booksy.com/fr-fr/123_studio")).toBe("BOOKSY");
    expect(detectBookingTool("https://widget.treatwell.fr/salon/x")).toBe("TREATWELL");
    expect(detectBookingTool("https://www.fresha.com/a/studio")).toBe("FRESHA");
    expect(detectBookingTool("https://app.acuityscheduling.com/schedule.php")).toBe("ACUITY");
  });

  it("treats the salon's own site as SITE, and no link as NONE", () => {
    expect(detectBookingTool("https://studio-camille.fr/reserver")).toBe("SITE");
    expect(detectBookingTool(null)).toBe("NONE");
    expect(detectBookingTool(undefined)).toBe("NONE");
    expect(detectBookingTool("")).toBe("NONE");
  });

  it("keeps an unparseable entry instead of discarding it", () => {
    // The salon typed something real; losing it would lose the lead's value.
    expect(detectBookingTool("planity dot com slash studio")).toBe("SITE");
  });
});

describe("externalRefFor", () => {
  it("prefers the Airtable id so both systems point at one lead", () => {
    expect(externalRefFor({ airtableRecordId: "recABC", phone: "0612345678" })).toBe(
      "laura_lead:recABC",
    );
  });

  it("falls back to the phone, ignoring how it was spaced", () => {
    // A resubmit typed "06 12 34 56 78" vs "0612345678" must not create a
    // second salon row.
    const a = externalRefFor({ airtableRecordId: null, phone: "06 12 34 56 78" });
    const b = externalRefFor({ airtableRecordId: null, phone: "0612345678" });
    expect(a).toBe(b);
    expect(a).toBe("laura_lead_phone:0612345678");
  });
});

describe("salonNameFor", () => {
  it("uses the salon name, falling back to the contact's", () => {
    expect(salonNameFor({ salon: "Studio Camille", name: "Camille" })).toBe("Studio Camille");
    expect(salonNameFor({ salon: null, name: "Camille" })).toBe("Camille");
    expect(salonNameFor({ salon: "   ", name: "Camille" })).toBe("Camille");
  });
});

describe("notesFor", () => {
  it("always says where the lead came from", () => {
    expect(notesFor({ source: null, utmSource: null, utmMedium: null, utmCampaign: null })).toBe(
      "Demande de rappel depuis /laura.",
    );
  });

  it("carries the attribution a commercial would want", () => {
    const notes = notesFor({
      source: "laura-page",
      utmSource: "meta",
      utmMedium: "cpc",
      utmCampaign: "laura-juillet",
    });
    expect(notes).toContain("Source : laura-page");
    expect(notes).toContain("UTM : meta / cpc / laura-juillet");
  });

  it("omits the UTM line entirely when there is none", () => {
    const notes = notesFor({
      source: "laura-page",
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    });
    expect(notes).not.toContain("UTM");
  });
});

describe("isBearerAuthorized", () => {
  it("accepts only the exact secret", () => {
    expect(isBearerAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isBearerAuthorized("Bearer wrong!", "s3cret")).toBe(false);
  });

  it("closes the endpoint when the secret is unset — never opens it", () => {
    // A missing env var must not become an unauthenticated write endpoint.
    expect(isBearerAuthorized("Bearer anything", undefined)).toBe(false);
    expect(isBearerAuthorized("Bearer anything", "")).toBe(false);
    expect(isBearerAuthorized("Bearer anything", "   ")).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(isBearerAuthorized(null, "s3cret")).toBe(false);
    expect(isBearerAuthorized("", "s3cret")).toBe(false);
    expect(isBearerAuthorized("s3cret", "s3cret")).toBe(false); // no "Bearer "
    expect(isBearerAuthorized("Basic s3cret", "s3cret")).toBe(false);
  });

  it("does not throw when the presented value differs in length", () => {
    // timingSafeEqual throws on unequal lengths; the guard must catch that.
    expect(() => isBearerAuthorized("Bearer short", "a-much-longer-secret")).not.toThrow();
    expect(isBearerAuthorized("Bearer short", "a-much-longer-secret")).toBe(false);
  });
});
