-- Add per-job onboarding overrides (P6 full onboarding).
-- Null → legacy disabled behavior; JSON carries loginEmail/loginPassword/enable/deposit/agentCount/reviewTarget.
ALTER TABLE "OnboardingJob" ADD COLUMN IF NOT EXISTS "config" JSONB;
