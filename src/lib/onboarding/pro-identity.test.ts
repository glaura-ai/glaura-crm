import { describe, expect, it } from "vitest";
import { evaluateProSalonIdentity, normalizeBookingClaim } from "./pro-identity";

describe("/pro salon identity verification", () => {
  it("accepts a distinctive salon-name match after normalization", () => {
    const result = evaluateProSalonIdentity({
      bookingSalonName: "Studio Camille Paris",
      bookingUrl: "https://www.planity.com/studio-camille",
      instagramUsername: "studio.camille",
      instagramDisplayName: "Studio Camille | Coiffure",
    });

    expect(result.status).toBe("verified");
    expect(result.signals).toContain("name_tokens");
  });

  it("accepts an acronym used by the salon brand", () => {
    const result = evaluateProSalonIdentity({
      bookingSalonName: "IBE - International Beauty Expert",
      bookingUrl: "https://www.planity.com/ibe-international-beauty-expert",
      instagramUsername: "ibe.paris",
      instagramDisplayName: "International Beauty Expert",
    });

    expect(result.status).toBe("verified");
    expect(result.signals).toContain("name_acronym");
  });

  it("holds unrelated accounts for review before a preview is created", () => {
    const result = evaluateProSalonIdentity({
      bookingSalonName: "Le Salon Incandescent",
      bookingUrl: "https://www.planity.com/le-salon-incandescent",
      instagramUsername: "gg_pyvalone",
      instagramDisplayName: "Py Valone",
    });

    expect(result.status).toBe("review_required");
    expect(result.score).toBeLessThan(result.requiredScore);
  });

  it("canonicalizes booking links for exclusive salon claims", () => {
    expect(normalizeBookingClaim("https://WWW.Planity.com/le-salon/?utm_source=ig#cta"))
      .toBe("planity.com/le-salon");
  });
});
