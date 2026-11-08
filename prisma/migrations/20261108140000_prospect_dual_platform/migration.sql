-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "dualPlatformCheckedAt" TIMESTAMP(3),
ADD COLUMN     "planityUrl" TEXT,
ADD COLUMN     "treatwellUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_treatwellUrl_key" ON "Prospect"("treatwellUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_planityUrl_key" ON "Prospect"("planityUrl");

-- Preserve the original platform as evidence; historical single-source rows are not
-- marked as a verified intersection until both pages have been matched.
UPDATE "Prospect" SET "treatwellUrl" = "sourceUrl" WHERE source = 'TREATWELL';
UPDATE "Prospect" SET "planityUrl" = "sourceUrl" WHERE source = 'PLANITY';
