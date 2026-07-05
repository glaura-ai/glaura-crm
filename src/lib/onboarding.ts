/**
 * Shared types for the salon onboarding pipeline.
 *
 * The legacy `startOnboardingJob` implementation — which shelled out to a
 * `claude -p` subprocess and streamed its stdout into OnboardingJobEvent rows —
 * was removed once the in-app worker (scripts/process-onboarding-jobs.ts) took
 * over the expand → extract → create-account pipeline (see
 * onboarding/.claude/commands/onboard-headless.md for the design). These types
 * remain the shared contract between the worker, create-account.ts's
 * `CreateAccountResult`, and the CRM hints derived from the salon row.
 */

export type OnboardingResult = {
  status?: string;
  ownerId?: string | null;
  email?: string | null;
  password?: string | null;
  address?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  serviceCount?: number | null;
  agentCount?: number | null;
  sourceType?: string | null;
  /** The salon booking-page URL that was onboarded. */
  url?: string | null;
  warnings?: unknown;
  error?: string | null;
};

export type OnboardingHints = {
  crmSalonId?: string | null;
  salonName?: string | null;
  instagram?: string | null;
  instagramHandle?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  bookingTool?: string | null;
};
