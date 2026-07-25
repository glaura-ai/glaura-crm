-- Retier prospects on Instagram presence instead of review count.
--
-- The pool was ranked by directory reviews, which surfaces big established
-- salons — the opposite of the target (small, independent, strong Instagram).
-- Followers now define the tier; reviews stay only as a tournée tiebreaker.
--
--   T4 IG fort    followers >= 5000
--   T3 IG moyen   followers 1000-4999
--   T2 IG faible  followers < 1000, Instagram confirmed
--   T1 IG inconnu no confirmed Instagram
--
-- Must stay in sync with computeTier in src/lib/prospection/tier.ts.
-- NULL followers (Instagram not yet enriched) is deliberately distinct from a
-- confirmed account with a small audience: unknown is T1, small is T2.

UPDATE "Prospect" SET "tier" = CASE
  WHEN "instagramFollowers" IS NULL   THEN 1
  WHEN "instagramFollowers" >= 5000   THEN 4
  WHEN "instagramFollowers" >= 1000   THEN 3
  ELSE 2
END;
