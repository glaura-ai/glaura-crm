import type { OnboardingOverrides } from "@/lib/onboarding";
import { GLAURA_EMAIL_DOMAIN } from "./account-model";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * CRM "Préparer le compte" jobs: log the salon in with the address the CRM
 * already knows instead of a `<slug>@glaura.fr` placeholder, so the portal
 * shows the real salon email. The welcome email stays off — the team sends
 * « Compte prêt » after the demo. Falls back to the placeholder (unchanged
 * overrides) when the address is missing, malformed, internal or already a
 * Firebase account, and never touches jobs that chose their own login.
 */
export async function withSalonContactLogin(
  overrides: OnboardingOverrides | undefined,
  contactEmail: string | null | undefined,
  emailAlreadyRegistered: (email: string) => Promise<boolean>,
): Promise<OnboardingOverrides | undefined> {
  if (overrides?.mode === "enrich" || overrides?.loginEmail?.trim() || overrides?.magicLinkSignIn) return overrides;

  const email = (contactEmail ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.endsWith(`@${GLAURA_EMAIL_DOMAIN}`)) return overrides;
  if (await emailAlreadyRegistered(email)) return overrides;

  return { ...overrides, loginEmail: email, sendWelcomeEmail: false };
}
