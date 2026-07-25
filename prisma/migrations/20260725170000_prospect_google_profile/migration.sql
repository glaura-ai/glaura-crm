-- Google Business Profile lookup for prospects.
--
-- Presence of a profile is a ranking signal (a findable, real business), never
-- a filter — prospects without one stay in the pool and in tournées.
--
-- googleRating / googleReviewCount (added earlier, still unfilled) stay NULL on
-- purpose: requesting those fields moves every Places Text Search call to the
-- Enterprise SKU (1 000/month free, then $35/1k) instead of Pro (5 000/month
-- free, then $32/1k). At ~3 300 prospects the Pro field mask keeps the whole
-- backfill inside the free allotment. See lib/prospection/google-places.ts.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "GoogleStatus" AS ENUM ('A_FAIRE', 'TROUVE', 'INTROUVABLE', 'ERREUR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "googlePlaceId" TEXT;
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "googleName" TEXT;
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "googleCheckedAt" TIMESTAMP(3);
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "googleStatus" "GoogleStatus" NOT NULL DEFAULT 'A_FAIRE';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Prospect_googleStatus_idx" ON "Prospect"("googleStatus");
