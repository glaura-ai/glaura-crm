ALTER TABLE "InstagramConversation"
  ADD COLUMN "qualification" TEXT,
  ADD COLUMN "qualificationReason" TEXT,
  ADD COLUMN "qualificationAction" TEXT,
  ADD COLUMN "qualificationConfidence" TEXT,
  ADD COLUMN "qualificationSource" TEXT,
  ADD COLUMN "qualifiedMessageId" TEXT,
  ADD COLUMN "qualifiedMessageHash" TEXT,
  ADD COLUMN "qualifiedAt" TIMESTAMP(3),
  ADD COLUMN "qualificationPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "qualificationStartedAt" TIMESTAMP(3),
  ADD COLUMN "qualificationError" TEXT;
ALTER TABLE "SalesTask" ADD COLUMN "instagramMessageId" TEXT;
