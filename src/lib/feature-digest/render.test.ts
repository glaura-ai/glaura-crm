import { describe, expect, it } from "vitest";
import { renderDigest } from "./render";
import type { CatalogFeature } from "./catalog";

const feature = (over: Partial<CatalogFeature> = {}): CatalogFeature => ({
  id: "codes-promo",
  publishedAt: "2026-10-01",
  titleFr: "Créez vos codes promo",
  titleEn: "Promo codes",
  benefitFr: "Un code en 10 secondes.",
  benefitEn: "A code in 10s.",
  hintFr: "h",
  hintEn: "h",
  href: "/promotions",
  emailImage: "https://images.glaura.ai/images/email/features/codes-promo.gif",
  ...over,
});

const base = {
  edition: "2026-11",
  salonName: "Chez Léa",
  portalBaseUrl: "https://pro.glaura.ai",
  unsubscribeUrl: "https://crm.glaura.ai/unsubscribe/salon?t=abc",
};

describe("renderDigest", () => {
  it("uses the default subject and links to /nouveautes#id", () => {
    const r = renderDigest({ ...base, features: [feature(), feature({ id: "b" }), feature({ id: "c" })] });
    expect(r.subject).toBe("3 nouveautés pour remplir votre agenda");
    expect(r.html).toContain('href="https://pro.glaura.ai/nouveautes#codes-promo"');
    expect(r.html).toContain("Bonjour Chez Léa");
    expect(r.html).toContain("Ne plus recevoir les nouveautés");
    expect(r.html).toContain(base.unsubscribeUrl);
    expect(r.text).toContain("https://pro.glaura.ai/nouveautes#codes-promo");
    expect(r.text).toContain(base.unsubscribeUrl);
  });

  it("allows a subject override", () => {
    expect(renderDigest({ ...base, features: [feature()], subject: "Hello" }).subject).toBe("Hello");
  });

  it("escapes catalog text and salon name", () => {
    const r = renderDigest({
      ...base,
      salonName: '<b>"x"</b>',
      features: [feature({ titleFr: "<script>alert(1)</script>", benefitFr: 'a "q" {{salon}}' })],
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("<b>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).not.toContain("{{salon}}");
  });

  it("falls back to a neutral greeting without a salon name", () => {
    expect(renderDigest({ ...base, salonName: "", features: [feature()] }).html).toContain("Bonjour,");
  });
});
