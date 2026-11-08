-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProspectSource" ADD VALUE 'GOOGLE';
ALTER TYPE "ProspectSource" ADD VALUE 'INSTAGRAM';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accessGrantedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "assignedToId" TEXT;

-- CreateTable
CREATE TABLE "SalesTask" (
    "requestKey" TEXT,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),
    "outcome" TEXT,
    "assignedToId" TEXT NOT NULL,
    "prospectId" TEXT,
    "salonId" TEXT,
    "instagramConversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "query" TEXT,
    "zone" TEXT NOT NULL,
    "source" TEXT,
    "limit" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "summary" TEXT,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),

    CONSTRAINT "ProspectRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramConversation" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "username" TEXT,
    "salonId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "InstagramConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "incoming" BOOLEAN NOT NULL,
    "text" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesTask_requestKey_key" ON "SalesTask"("requestKey");

-- CreateIndex
CREATE INDEX "SalesTask_assignedToId_doneAt_dueAt_idx" ON "SalesTask"("assignedToId", "doneAt", "dueAt");

-- CreateIndex
CREATE INDEX "SalesTask_prospectId_idx" ON "SalesTask"("prospectId");

-- CreateIndex
CREATE INDEX "SalesTask_salonId_idx" ON "SalesTask"("salonId");

-- CreateIndex
CREATE INDEX "ProspectRun_status_createdAt_idx" ON "ProspectRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InstagramConversation_lastMessageAt_idx" ON "InstagramConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "InstagramMessage_conversationId_sentAt_idx" ON "InstagramMessage"("conversationId", "sentAt");

-- CreateIndex
CREATE INDEX "Prospect_assignedToId_status_idx" ON "Prospect"("assignedToId", "status");

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectRun" ADD CONSTRAINT "ProspectRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramMessage" ADD CONSTRAINT "InstagramMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "InstagramConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve ownership from old daily rounds and surface unfinished work immediately.
UPDATE "Prospect" p SET "assignedToId" = t."assignedToId"
FROM "Tournee" t WHERE p."tourneeId" = t.id AND p."assignedToId" IS NULL;

INSERT INTO "SalesTask" (id, title, "dueAt", "assignedToId", "prospectId", "createdAt", "updatedAt")
SELECT 'legacy-prospect:' || p.id, 'Contacter le salon',
  ((t.date::date + TIME '18:00') AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC',
  p."assignedToId", p.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Prospect" p JOIN "Tournee" t ON t.id = p."tourneeId"
WHERE p.status = 'EN_TOURNEE' AND p."assignedToId" IS NOT NULL;

