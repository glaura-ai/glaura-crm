ALTER TABLE "User" ADD COLUMN "bookingUrl" TEXT;

ALTER TABLE "OutreachSequence" ADD COLUMN "linkToken" TEXT,
  ADD COLUMN "linkClicks" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "linkClickedAt" TIMESTAMP(3);
UPDATE "OutreachSequence" SET "linkToken" = gen_random_uuid()::text WHERE "linkToken" IS NULL;
ALTER TABLE "OutreachSequence" ALTER COLUMN "linkToken" SET NOT NULL;
CREATE UNIQUE INDEX "OutreachSequence_linkToken_key" ON "OutreachSequence"("linkToken");
