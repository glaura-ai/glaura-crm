-- Prospection: prospects discovered on public booking directories + daily tournées.

-- AlterEnum
ALTER TYPE "BookingTool" ADD VALUE IF NOT EXISTS 'BOOKSY';
ALTER TYPE "BookingTool" ADD VALUE IF NOT EXISTS 'FRESHA';

-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'SCRAPE';

-- CreateEnum
CREATE TYPE "ProspectSource" AS ENUM ('PLANITY', 'TREATWELL', 'BOOKSY', 'FRESHA');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('NOUVEAU', 'EN_TOURNEE', 'CONVERTI', 'ECARTE', 'DEJA_CRM');

-- CreateTable
CREATE TABLE "Tournee" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "zone" TEXT NOT NULL,
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tournee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "metiers" "Metier"[] DEFAULT ARRAY[]::"Metier"[],
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "source" "ProspectSource" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "instagram" TEXT,
    "instagramFollowers" INTEGER,
    "igCandidates" JSONB,
    "status" "ProspectStatus" NOT NULL DEFAULT 'NOUVEAU',
    "matchedSalonId" TEXT,
    "salonId" TEXT,
    "tourneeId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tournee_date_zone_key" ON "Tournee"("date", "zone");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_sourceUrl_key" ON "Prospect"("sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_salonId_key" ON "Prospect"("salonId");

-- CreateIndex
CREATE INDEX "Prospect_zone_status_reviewCount_idx" ON "Prospect"("zone", "status", "reviewCount");

-- CreateIndex
CREATE INDEX "Prospect_status_idx" ON "Prospect"("status");

-- CreateIndex
CREATE INDEX "Prospect_tourneeId_idx" ON "Prospect"("tourneeId");

-- AddForeignKey
ALTER TABLE "Tournee" ADD CONSTRAINT "Tournee_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_tourneeId_fkey" FOREIGN KEY ("tourneeId") REFERENCES "Tournee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
