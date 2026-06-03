-- CreateEnum
CREATE TYPE "Role" AS ENUM ('COMMERCIAL', 'ADMIN');

-- CreateEnum
CREATE TYPE "Metier" AS ENUM ('COIFFURE', 'ESTHETIQUE', 'ONGLES', 'BARBIER', 'SPA', 'AUTRE');

-- CreateEnum
CREATE TYPE "SalonType" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "SalonStatus" AS ENUM ('A_VISITER', 'VISITE_FAITE', 'INTERESSE', 'A_RELANCER', 'PAS_INTERESSE', 'SIGNE');

-- CreateEnum
CREATE TYPE "BookingTool" AS ENUM ('PLANITY', 'TREATWELL', 'ACUITY', 'SITE', 'NONE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('APPEL', 'VISIO', 'VISITE', 'RELANCE', 'EMAIL', 'DEMO', 'NOTE');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('MANUAL', 'AIRTABLE', 'IMPORT');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'ALREADY_ONBOARDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'COMMERCIAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLogin" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salon" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "metier" "Metier" NOT NULL DEFAULT 'AUTRE',
    "type" "SalonType",
    "arrondissement" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "instagram" TEXT,
    "bookingTool" "BookingTool" NOT NULL DEFAULT 'NONE',
    "bookingUrl" TEXT,
    "rating" DOUBLE PRECISION,
    "status" "SalonStatus" NOT NULL DEFAULT 'A_VISITER',
    "notes" TEXT,
    "assignedToId" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'MANUAL',
    "externalRef" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Salon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "ActivityType" NOT NULL,
    "notes" TEXT,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingJob" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "requestedById" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'QUEUED',
    "accountUid" TEXT,
    "loginEmail" TEXT,
    "loginPassword" TEXT,
    "serviceCount" INTEGER,
    "agentCount" INTEGER,
    "videoCount" INTEGER,
    "warnings" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Salon_slug_key" ON "Salon"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Salon_externalRef_key" ON "Salon"("externalRef");

-- CreateIndex
CREATE INDEX "Salon_status_idx" ON "Salon"("status");

-- CreateIndex
CREATE INDEX "Salon_metier_idx" ON "Salon"("metier");

-- CreateIndex
CREATE INDEX "Salon_arrondissement_idx" ON "Salon"("arrondissement");

-- CreateIndex
CREATE INDEX "Salon_assignedToId_idx" ON "Salon"("assignedToId");

-- CreateIndex
CREATE INDEX "Salon_nextActionAt_idx" ON "Salon"("nextActionAt");

-- CreateIndex
CREATE INDEX "Activity_salonId_createdAt_idx" ON "Activity"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "Reminder_userId_done_dueAt_idx" ON "Reminder"("userId", "done", "dueAt");

-- CreateIndex
CREATE INDEX "Reminder_salonId_idx" ON "Reminder"("salonId");

-- CreateIndex
CREATE INDEX "OnboardingJob_status_idx" ON "OnboardingJob"("status");

-- CreateIndex
CREATE INDEX "OnboardingJob_salonId_idx" ON "OnboardingJob"("salonId");

-- AddForeignKey
ALTER TABLE "Salon" ADD CONSTRAINT "Salon_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingJob" ADD CONSTRAINT "OnboardingJob_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingJob" ADD CONSTRAINT "OnboardingJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
