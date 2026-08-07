ALTER TYPE "OnboardingStatus" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';

ALTER TABLE "Salon" ADD COLUMN "bookingUrlNormalized" TEXT;
CREATE UNIQUE INDEX "Salon_bookingUrlNormalized_key" ON "Salon"("bookingUrlNormalized");
