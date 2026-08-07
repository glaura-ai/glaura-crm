import { describe, expect, it } from "vitest";
import { renderActivationReadyEmail, renderMagicLinkEmail } from "./magic-link";

describe("activation-ready email", () => {
  it("uses the branded account-ready layout with a safe single-use link", () => {
    const email = renderActivationReadyEmail({
      salonName: "Studio <Camille>",
      magicLink: "https://pro.glaura.ai/bienvenue?t=one&next=two",
    });

    expect(email.html).toContain("cid:glaura-logo");
    expect(email.html).toContain("COMPTE ACTIVÉ");
    expect(email.html).toContain("Studio &lt;Camille&gt;");
    expect(email.html).toContain("t=one&amp;next=two");
    expect(email.html).not.toContain("{{");
    expect(email.text).toContain("usage unique");
  });

  it("does not claim payment confirmation in generic passwordless onboarding", () => {
    const email = renderMagicLinkEmail({
      salonName: "Studio Camille",
      magicLink: "https://pro.glaura.ai/bienvenue?t=generic",
    });

    expect(email.html).not.toContain("COMPTE ACTIVÉ");
    expect(email.html).not.toContain("abonnement est confirmé");
  });
});
