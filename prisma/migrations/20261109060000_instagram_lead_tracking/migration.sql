ALTER TABLE "InstagramConversation" ADD COLUMN "waitingAt" TIMESTAMP(3);
-- Keep old inbox records if their formerly unvalidated link no longer exists.
UPDATE "InstagramConversation" AS c SET "salonId" = NULL
WHERE "salonId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Salon" AS s WHERE s.id = c."salonId");
CREATE INDEX "InstagramConversation_salonId_idx" ON "InstagramConversation"("salonId");
ALTER TABLE "InstagramConversation" ADD CONSTRAINT "InstagramConversation_salonId_fkey"
FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
