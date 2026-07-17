-- Instagram enrichment lifecycle on Prospect.

-- CreateEnum
CREATE TYPE "IgStatus" AS ENUM ('A_FAIRE', 'CONFIRME', 'A_VALIDER', 'INTROUVABLE', 'ERREUR');

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "igStatus" "IgStatus" NOT NULL DEFAULT 'A_FAIRE';
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "igCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Prospect_igStatus_idx" ON "Prospect"("igStatus");
