import { describe, expect, it } from "vitest";

import {
  buildLauraUserProfile,
  LAURA_TRIAL_DAYS,
  normalizeInstagram,
  trialWindow,
} from "./laura-account";

const input = {
  bookingUrl: "https://www.planity.com/studio-camille",
  contactName: "Camille Laurent",
  email: "camille@studio.fr",
  instagram: "@studio.camille",
  phone: "06 12 34 56 78",
  salonName: "Studio Camille",
};

const ctx = { companyUserName: "studio-camille", now: new Date("2026-07-31T09:00:00Z"), uid: "uid_1" };

describe("normalizeInstagram", () => {
  it("accepts every shape a salon types", () => {
    expect(normalizeInstagram("@studio.camille")).toBe("studio.camille");
    expect(normalizeInstagram("studio.camille")).toBe("studio.camille");
    expect(normalizeInstagram("https://www.instagram.com/studio.camille/")).toBe("studio.camille");
    expect(normalizeInstagram("instagram.com/studio.camille?hl=fr")).toBe("studio.camille");
  });

  it("returns empty for nothing", () => {
    expect(normalizeInstagram(null)).toBe("");
    expect(normalizeInstagram("  ")).toBe("");
  });
});

describe("trialWindow", () => {
  it("starts the clock at creation, not at first login", () => {
    const now = new Date("2026-07-31T09:00:00Z");
    const { startedAt, endsAt } = trialWindow(now);
    expect(startedAt).toEqual(now);
    expect(endsAt.getTime() - now.getTime()).toBe(LAURA_TRIAL_DAYS * 86_400_000);
  });
});

describe("buildLauraUserProfile", () => {
  const profile = buildLauraUserProfile(input, ctx);

  it("puts the salon on the Laura offer", () => {
    // This exact code is what makes the portal render the reduced view.
    expect(profile.subscriptionPlanCode).toBe("laura_lite");
  });

  it("is a service provider, so the portal lets it in", () => {
    expect(profile.userRole).toBe(2);
    expect(profile.initialUserRole).toBe(2);
    expect(profile.isDeleted).toBe(false);
  });

  it("stamps the trial so billing-state does not re-seed it on first access", () => {
    expect(profile.trialStartedAt).toBeDefined();
    expect(profile.trialEndsAt).toBeDefined();
  });

  it("keeps the salon off the marketplace", () => {
    // The offer is invisible infrastructure behind their Instagram; a salon
    // that asked to be called has not asked to be listed.
    expect(profile.enable).toBe(false);
  });

  it("leaves Laura switched off until the salon has connected something", () => {
    expect(profile.aiAssistantEnabled).toBe(false);
  });

  it("keeps the booking link for the setup checklist without acting on it", () => {
    expect(profile.bookingUrl).toBe("https://www.planity.com/studio-camille");
  });

  it("carries no catalogue — the salon's own tool owns that", () => {
    // Guards against someone later "helpfully" seeding services or agents here,
    // which is the scrape behaviour this path exists to avoid.
    expect(profile).not.toHaveProperty("services");
    expect(profile).not.toHaveProperty("agents");
    expect(profile).not.toHaveProperty("timing");
  });
});
