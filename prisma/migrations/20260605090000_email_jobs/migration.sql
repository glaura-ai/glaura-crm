-- CreateEnum
CREATE TYPE "EmailJobStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailTemplate" AS ENUM ('INTRO', 'DEMO_FOLLOW_UP', 'RELANCE', 'SIGNATURE_NEXT_STEPS');

-- CreateTable
CREATE TABLE "EmailJob" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "requestedById" TEXT,
    "to" TEXT NOT NULL,
    "from" TEXT,
    "template" "EmailTemplate" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "EmailJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailJob_status_createdAt_idx" ON "EmailJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailJob_salonId_createdAt_idx" ON "EmailJob"("salonId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
