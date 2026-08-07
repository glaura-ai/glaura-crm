import { describe, expect, it } from "vitest";
import {
  evaluateProSalonIdentity,
  isProIdentityTestBypassAllowed,
  normalizeBookingClaim,
} from "./pro-identity";

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

  it("allows only explicit Instagram handles in the test bypass allowlist", () => {
    const allowlist = "glaura.test, @owner_demo\nibe.testing";

    expect(isProIdentityTestBypassAllowed("@OWNER_DEMO", allowlist)).toBe(true);
    expect(isProIdentityTestBypassAllowed("ibe.testing", allowlist)).toBe(true);
    expect(isProIdentityTestBypassAllowed("competitor", allowlist)).toBe(false);
    expect(isProIdentityTestBypassAllowed("glaura.test.fake", allowlist)).toBe(false);
  });

  it("does not support a wildcard identity bypass", () => {
    expect(isProIdentityTestBypassAllowed("any-account", "*")).toBe(false);
    expect(isProIdentityTestBypassAllowed("any-account", "")).toBe(false);
  });

  it("fully accepts an unrelated salon when the verified handle is test-allowlisted", () => {
    const result = evaluateProSalonIdentity({
      bookingSalonName: "IBE - International Beauty Expert",
      bookingUrl: "https://www.planity.com/international-beauty-expert-75016-paris",
      instagramUsername: "gg_pyvalone",
      instagramDisplayName: "Py Valone",
    }, { bypassAllChecks: true });

    expect(result.status).toBe("verified");
    expect(result.score).toBe(result.requiredScore);
    expect(result.signals).toEqual(["test_allowlist"]);
  });
});
