import { describe, expect, it } from "vitest";
import { buildReviewDocs } from "./account-model";
import { extractPageReviews } from "./extract";

const NOW = new Date("2026-09-29T10:00:00Z");

function planityHtml(reviews: unknown[]): string {
  const ld = { "@type": "HairSalon", name: "Salon Test", review: reviews };
  return `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>Salon Test</h1></body></html>`;
}

function ldReview(body: string, rating: number, date: string) {
  return {
    "@type": "Review",
    author: { "@type": "Person", name: "Anonyme" },
    datePublished: date,
    reviewBody: body,
    reviewRating: { "@type": "Rating", ratingValue: rating },
  };
}

describe("buildReviewDocs", () => {
  it("never adds filler reviews beyond the real ones", () => {
    const result = buildReviewDocs([{ author: "Anonyme", rating: 5, text: "Super", date: "2026-09-13" }], 25, NOW);
    expect(result.reviews).toHaveLength(1);
    expect(result.total_review).toBe(1);
  });

  it("keeps the real rating and averages it", () => {
    const result = buildReviewDocs(
      [
        { author: "A", rating: 4, text: "Bien", date: "2026-09-01" },
        { author: "B", rating: 5, text: "Top", date: "2026-08-01" },
      ],
      10,
      NOW,
    );
    expect(result.reviews.map((r) => r.ratting)).toEqual([4, 5]);
    expect(result.avg_ratting).toBe(4.5);
  });

  it("uses the published date instead of a synthetic one", () => {
    const result = buildReviewDocs([{ author: "A", rating: 5, text: "Top", date: "2026-05-24" }], 10, NOW);
    expect(result.reviews[0].createdAt.toISOString()).toBe("2026-05-24T12:00:00.000Z");
  });

  it("skips reviews without text or without a rating", () => {
    const result = buildReviewDocs(
      [
        { author: "A", rating: 5, text: "", date: "2026-09-01" },
        { author: "B", rating: null, text: "Sans note", date: "2026-09-01" },
        { author: "C", rating: 5, text: "Gardé", date: "2026-09-01" },
      ],
      10,
      NOW,
    );
    expect(result.reviews.map((r) => r.review)).toEqual(["Gardé"]);
  });

  it("caps at the requested count", () => {
    const real = Array.from({ length: 5 }, (_, i) => ({ author: "A", rating: 5, text: `Avis ${i}`, date: null }));
    expect(buildReviewDocs(real, 3, NOW).reviews).toHaveLength(3);
  });

  it("returns zero aggregates when there are no real reviews", () => {
    const result = buildReviewDocs([], 15, NOW);
    expect(result).toEqual({ reviews: [], avg_ratting: 0, total_review: 0 });
  });
});

describe("extractPageReviews", () => {
  it("reads Planity reviews verbatim from the page JSON-LD", () => {
    const html = planityHtml([ldReview("Caroline est au top", 5, "2026-04-24"), ldReview("Bien", 4, "2026-04-01")]);
    expect(extractPageReviews(html, "planity")).toEqual([
      { author: "Anonyme", rating: 5, text: "Caroline est au top", date: "2026-04-24" },
      { author: "Anonyme", rating: 4, text: "Bien", date: "2026-04-01" },
    ]);
  });

  it("returns no reviews when the page has none", () => {
    expect(extractPageReviews(planityHtml([]), "planity")).toEqual([]);
  });
});
