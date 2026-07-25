-- Duplicate handling for salons.
--
-- ~17% of the Salon table is duplicated (the same business imported from both
-- Airtable bases, plus a create-path bug that produced 32 identical rows in 74
-- seconds on 2026-06-15). Deduplicating must not destroy rows: a duplicate is
-- archived and linked to the record it was merged into, so the operation stays
-- auditable and can be reversed.

-- AlterTable
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "archiveNote" TEXT;
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "Salon" ADD CONSTRAINT "Salon_mergedIntoId_fkey"
    FOREIGN KEY ("mergedIntoId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Salon_archivedAt_idx" ON "Salon"("archivedAt");
