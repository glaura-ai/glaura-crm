-- AlterTable
ALTER TABLE "Salon" ADD COLUMN     "accountStatusLabel" TEXT,
ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "airtableBaseId" TEXT,
ADD COLUMN     "airtableRecordUrl" TEXT,
ADD COLUMN     "airtableTableId" TEXT,
ADD COLUMN     "airtableTableName" TEXT,
ADD COLUMN     "appointmentAt" TIMESTAMP(3),
ADD COLUMN     "clientBaseImported" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "importedClientCount" INTEGER,
ADD COLUMN     "leadTemperature" TEXT,
ADD COLUMN     "objection" TEXT,
ADD COLUMN     "priorityLabel" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "sourceLabel" TEXT;

-- CreateIndex
CREATE INDEX "Salon_airtableBaseId_idx" ON "Salon"("airtableBaseId");
