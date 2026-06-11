-- AlterTable
ALTER TABLE "Salon" ADD COLUMN "priorityDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Salon_assignedToId_priorityDate_idx" ON "Salon"("assignedToId", "priorityDate");
