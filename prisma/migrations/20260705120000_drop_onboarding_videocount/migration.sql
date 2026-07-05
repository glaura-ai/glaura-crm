-- Drop the now-unused OnboardingJob.videoCount column. Instagram video
-- seeding was retired with the legacy `claude -p` onboarding flow (P5); the
-- in-app worker never populated it (always 0/null).
ALTER TABLE "OnboardingJob" DROP COLUMN "videoCount";
