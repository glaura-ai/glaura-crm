// Prospecting tiers (ascending: T1 = baseline … T4 = top).
//
// Instagram presence is the primary rank: the salons worth calling are small,
// independent ones with a real audience, not whichever salon has accumulated the
// most directory reviews. Review count still matters, but only as a tiebreaker
// within a tier (generateTournee sorts on it after tier).
//
// Followers are known only for IG-confirmed prospects, so an unconfirmed one sits
// at T1 until the enrichment cron reaches it — T1 means "Instagram unknown", not
// "bad prospect".

export const MIN_TIER = 1;
export const MAX_TIER = 4;

// Follower thresholds defining the bands.
export const IG_BIG_MIN = 5000;
export const IG_MEDIUM_MIN = 1000;

export const TIER_LABEL: Record<number, string> = {
  1: "IG inconnu",
  2: "IG faible",
  3: "IG moyen",
  4: "IG fort",
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

// `followers` null/undefined means Instagram has not been confirmed yet, which is
// distinct from a confirmed account that happens to have few followers (T2).
export function computeTier(followers: number | null | undefined): number {
  if (followers == null) return 1;
  if (followers >= IG_BIG_MIN) return 4;
  if (followers >= IG_MEDIUM_MIN) return 3;
  return 2;
}

export function tierForProspect(p: { instagramFollowers?: number | null }): number {
  return computeTier(p.instagramFollowers);
}
