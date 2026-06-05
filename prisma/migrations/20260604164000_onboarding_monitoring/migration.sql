-- Add durable monitoring fields for Claude-driven onboarding jobs.
ALTER TABLE "OnboardingJob"
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3),
  ADD COLUMN "durationMs" INTEGER,
  ADD COLUMN "exitCode" INTEGER,
  ADD COLUMN "eventCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastEventAt" TIMESTAMP(3);

CREATE TABLE "OnboardingJobEvent" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "stream" TEXT NOT NULL,
  "type" TEXT,
  "subtype" TEXT,
  "level" TEXT,
  "text" TEXT,
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OnboardingJobEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingJobEvent_jobId_sequence_key" ON "OnboardingJobEvent"("jobId", "sequence");
CREATE INDEX "OnboardingJobEvent_jobId_createdAt_idx" ON "OnboardingJobEvent"("jobId", "createdAt");
CREATE INDEX "OnboardingJobEvent_type_idx" ON "OnboardingJobEvent"("type");
CREATE INDEX "OnboardingJob_createdAt_idx" ON "OnboardingJob"("createdAt");

ALTER TABLE "OnboardingJobEvent"
  ADD CONSTRAINT "OnboardingJobEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "OnboardingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
