import { describe, expect, it } from "vitest";
import {
  buildProPreviewUrl,
  hashProPreviewToken,
  proPortalUrlForStripeMode,
  proPreviewToken,
  renderProPreviewEmail,
  subscriptionMatchesActivation,
} from "./pro-preview";

describe("/pro preview activation", () => {
  it("derives a stable opaque token from the job and a server secret", () => {
    const token = proPreviewToken("job_123", "a".repeat(32));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).toBe(proPreviewToken("job_123", "a".repeat(32)));
    expect(token).not.toBe(proPreviewToken("job_124", "a".repeat(32)));
  });

  it("stores only a SHA-256 hash of the preview bearer token", () => {
    expect(hashProPreviewToken("opaque")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds the tokenized preview on the canonical /pro route", () => {
    expect(buildProPreviewUrl("https://glaura.ai/", "opaque_token"))
      .toBe("https://glaura.ai/pro/preview/opaque_token");
    expect(buildProPreviewUrl("https://staging-1.glaura.ai", "opaque_token"))
      .toBe("https://staging-1.glaura.ai/pro/preview/opaque_token");
  });

  it("keeps welcome links in the Stripe environment that activated the salon", () => {
    expect(proPortalUrlForStripeMode(true)).toBe("https://pro.glaura.ai");
    expect(proPortalUrlForStripeMode(false)).toBe("https://staging-pro.glaura.ai");
  });

  it("renders email and plaintext alternatives with the salon preview", () => {
    const email = renderProPreviewEmail({
      previewUrl: "https://glaura.ai/pro/preview/token",
      salonName: "Studio Camille",
      serviceCount: 8,
    });
    expect(email.subject).toContain("Studio Camille");
    expect(email.html).toContain("https://glaura.ai/pro/preview/token");
    expect(email.text).toContain("8 prestations");
  });

  it("requires an active/trialing subscription for the selected plan", () => {
    expect(subscriptionMatchesActivation({
      stripeSubscriptionId: "sub_1",
      stripeSubscriptionIsLive: true,
      stripeSubscriptionPlanCode: "basic",
      stripeSubscriptionStatus: "trialing",
    }, "basic")).toBe(true);
    expect(subscriptionMatchesActivation({
      stripeSubscriptionId: "sub_1",
      stripeSubscriptionIsLive: true,
      stripeSubscriptionPlanCode: "reservation",
      stripeSubscriptionStatus: "active",
    }, "basic")).toBe(false);
    expect(subscriptionMatchesActivation({
      stripeSubscriptionId: "sub_1",
      stripeSubscriptionIsLive: true,
      stripeSubscriptionPlanCode: "basic",
      stripeSubscriptionStatus: "past_due",
    }, "basic")).toBe(false);
    expect(subscriptionMatchesActivation({
      stripeSubscriptionId: "sub_test",
      stripeSubscriptionIsLive: false,
      stripeSubscriptionPlanCode: "basic",
      stripeSubscriptionStatus: "trialing",
    }, "basic")).toBe(false);
    expect(subscriptionMatchesActivation({
      stripeSubscriptionId: "sub_test",
      stripeSubscriptionIsLive: false,
      stripeSubscriptionPlanCode: "basic",
      stripeSubscriptionStatus: "trialing",
    }, "basic", false)).toBe(true);
    expect(subscriptionMatchesActivation({
      stripeSubscriptionId: "sub_live",
      stripeSubscriptionIsLive: true,
      stripeSubscriptionPlanCode: "basic",
      stripeSubscriptionStatus: "trialing",
    }, "basic", false)).toBe(false);
  });
});
