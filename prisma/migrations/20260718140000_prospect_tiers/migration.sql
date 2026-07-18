-- Prospecting tiers + Google review columns (Google deferred; tier from
-- booking reviews + IG followers for now).

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "googleRating" DOUBLE PRECISION;
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "googleReviewCount" INTEGER;
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "tier" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Prospect_zone_status_tier_idx" ON "Prospect"("zone", "status", "tier");

-- Backfill tier from current data (combined reviews + followers).
UPDATE "Prospect" SET "tier" = CASE
  WHEN ("reviewCount" + COALESCE("googleReviewCount", 0)) >= 250 AND COALESCE("instagramFollowers", 0) >= 3000 THEN 4
  WHEN ("reviewCount" + COALESCE("googleReviewCount", 0)) >= 100 AND COALESCE("instagramFollowers", 0) >= 1000 THEN 3
  WHEN ("reviewCount" + COALESCE("googleReviewCount", 0)) >= 100 THEN 2
  ELSE 1
END;
