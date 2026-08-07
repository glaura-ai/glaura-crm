import { describe, expect, it } from "vitest";
import {
  formatTrialEndDate,
  renderTrialEndingEmail,
  trialEndingRequestSchema,
  trialEndingSmsBody,
} from "./trial-ending";

const data = {
  salonName: "Studio <Camille>",
  planName: "Réservation",
  trialEndsAt: "2026-08-21T13:53:38.000Z",
  billingUrl: "https://pro.glaura.ai/payments?tab=subscription",
};

describe("trial-ending notification contract", () => {
  it("accepts live and staging Glaura Pro billing links", () => {
    for (const billingUrl of [
      data.billingUrl,
      "https://staging-pro.glaura.ai/payments?tab=subscription",
    ]) {
      expect(trialEndingRequestSchema.safeParse({
        eventId: "evt_123",
        providerId: "uid_123",
        to: "salon@example.com",
        phone: "0612345678",
        data: { ...data, billingUrl },
      }).success).toBe(true);
    }
  });

  it("rejects arbitrary CTA hosts and invalid recipients", () => {
    expect(trialEndingRequestSchema.safeParse({
      eventId: "evt_123",
      providerId: "uid_123",
      to: "not-an-email",
      data: { ...data, billingUrl: "https://example.com/steal" },
    }).success).toBe(false);
  });
});

describe("trial-ending content", () => {
  it("formats the Stripe timestamp in Paris and renders escaped HTML", () => {
    expect(formatTrialEndDate(data.trialEndsAt)).toBe("vendredi 21 août 2026");
    const email = renderTrialEndingEmail(data);
    expect(email.subject).toContain("Studio <Camille>");
    expect(email.subject).toContain("vendredi 21 août 2026");
    expect(email.html).toContain("Studio &lt;Camille&gt;");
    expect(email.html).toContain("Réservation");
    expect(email.html).toContain(data.billingUrl.replace("&", "&amp;"));
    expect(email.html).toContain("cid:glaura-logo");
    expect(email.html).not.toContain("{{");
    expect(email.text).toContain("démarrera automatiquement");
  });

  it("keeps the SMS concise and links to subscription management", () => {
    const sms = trialEndingSmsBody(data);
    expect(sms).toContain("vendredi 21 août 2026");
    expect(sms).toContain("démarrera automatiquement");
    expect(sms).toContain(data.billingUrl);
  });
});
