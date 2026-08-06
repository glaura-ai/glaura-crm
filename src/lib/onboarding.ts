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

/**
 * Per-job onboarding overrides (P6 — full-enrichment pipeline). Absent/empty
 * means the legacy default: a DISABLED account with a generated
 * `<slug>@glaura.fr` email and no agents/reviews/deposit. Supplied per job via
 * the `OnboardingJob.config` JSON column so existing salons are unaffected.
 */
export type OnboardingOverrides = {
  /**
   * Onboarding mode.
   * - `"create"` (default when absent): provision a brand-new Firebase account
   *   from scratch — the legacy/concierge path.
   * - `"enrich"`: attach the extracted salon data (services, opening hours,
   *   photos, agents, reviews) onto an EXISTING account identified by
   *   `targetUid`. Used by the self-serve wizard, which creates the Firebase
   *   account itself (with the salon's chosen credentials) and drops the salon
   *   into the portal before this job runs — so the worker must never create a
   *   second account. See docs/product/32-self-serve-onboarding-implementation.md §3b.
   */
  mode?: "create" | "enrich" | null;
  /**
   * Existing Firebase Auth uid to enrich when `mode === "enrich"`. Matching is
   * by uid (not email) to avoid races with the account the portal just created.
   */
  targetUid?: string | null;
  /** Firebase Auth email to use instead of the generated `<slug>@glaura.fr`. */
  loginEmail?: string | null;
  /** Firebase Auth password to use instead of the random generated one. */
  loginPassword?: string | null;
  /** When true, the account is created LIVE (enable/isActive/available = true). */
  enable?: boolean | null;
  /** Booking deposit percentage (0–100) written to `spdeposit`/`depositPercentage`. */
  deposit?: number | null;
  /** Number of synthesized agents to create (each assigned to all services). */
  agentCount?: number | null;
  /** Total number of 5★ reviews to end up with (real Planity reviews first, then filled). */
  reviewTarget?: number | null;
  /**
   * When true, the create path skips the plaintext-password welcome email and
   * instead mints a single-use sign-in token + sends the passwordless
   * "Accéder à mon salon" magic-link email (self-serve form flow). Ignored in
   * enrich mode. See docs/product/32-self-serve-onboarding-implementation.md.
   */
  magicLinkSignIn?: boolean | null;
  /** Public /pro conversion flow: enrich an inactive account, generate a
   * tokenized salon preview and withhold access until Stripe activation. */
  activationPreview?: boolean | null;
  planCode?: "basic" | "reservation" | null;
  trialPeriodDays?: number | null;
  /** Public website origin captured by the portal before OAuth. */
  publicBaseUrl?: "https://glaura.ai" | "https://staging-1.glaura.ai" | null;
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
