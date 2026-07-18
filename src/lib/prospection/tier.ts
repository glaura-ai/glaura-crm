// Prospecting tiers (ascending: T1 = baseline … T4 = top).
// Ranks a prospect by combined review count (booking directory + Google, once
// available) and Instagram followers. Followers are only known for IG-confirmed
// prospects (null → treated as 0, so unconfirmed prospects can't reach T3/T4).

export const MIN_TIER = 1;
export const MAX_TIER = 4;

export const TIER_LABEL: Record<number, string> = {
  1: "Base",
  2: "Actif",
  3: "Établi",
  4: "Référence",
};

// Tailwind chip classes per tier.
export const TIER_STYLE: Record<number, string> = {
  1: "bg-slate-100 text-slate-600",
  2: "bg-sky-100 text-sky-700",
  3: "bg-violet-100 text-violet-700",
  4: "bg-amber-100 text-amber-800",
};

export function combinedReviews(reviewCount: number, googleReviewCount: number | null | undefined): number {
  return reviewCount + (googleReviewCount ?? 0);
}

export function computeTier(reviews: number, followers: number | null | undefined): number {
  const f = followers ?? 0;
  if (reviews >= 250 && f >= 3000) return 4;
  if (reviews >= 100 && f >= 1000) return 3;
  if (reviews >= 100) return 2;
  return 1;
}

export function tierForProspect(p: {
  reviewCount: number;
  googleReviewCount?: number | null;
  instagramFollowers?: number | null;
}): number {
  return computeTier(combinedReviews(p.reviewCount, p.googleReviewCount), p.instagramFollowers);
}
