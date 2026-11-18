CREATE TABLE "OutreachSequence" (
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "step" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "phone" TEXT,
    "stopReason" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "leaseAt" TIMESTAMP(3),
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachSequence_pkey" PRIMARY KEY ("conversationId")
);

CREATE INDEX "OutreachSequence_status_nextRunAt_idx" ON "OutreachSequence"("status", "nextRunAt");

ALTER TABLE "OutreachSequence" ADD CONSTRAINT "OutreachSequence_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "InstagramConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
