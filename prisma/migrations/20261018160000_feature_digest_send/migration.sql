-- CreateTable
CREATE TABLE "FeatureDigestSend" (
    "id" TEXT NOT NULL,
    "edition" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureDigestSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeatureDigestSend_edition_idx" ON "FeatureDigestSend"("edition");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureDigestSend_edition_providerId_key" ON "FeatureDigestSend"("edition", "providerId");
