/**
 * PURE authorization predicates for onboarded-account credentials.
 *
 * Kept separate from actions.ts so the salon page (deciding whether to render
 * the reveal control) and the server action (enforcing the rule before it
 * decrypts) share one definition — a UI that hides the button while the action
 * still allows the call, or vice versa, is the classic way this drifts.
 */

/** The viewer fields the credential rules depend on. */
export interface CredentialViewer {
  id?: string | null;
  role?: string | null;
}

/** The salon fields the credential rules depend on. */
export interface CredentialSalon {
  assignedToId: string | null;
}

/**
 * Who may reveal an onboarded salon account's password: the assigned commercial
 * or any admin.
 *
 * Deliberately NOT gated on `SalonStatus` the way `triggerOnboarding` is — the
 * rep needs the credential to run the demo, and the demo is what gets the salon
 * to SIGNE in the first place. Gating on SIGNE would lock the password away
 * during the exact window it is needed.
 */
export function canRevealOnboardingPassword(
  viewer: CredentialViewer | null | undefined,
  salon: CredentialSalon,
): boolean {
  if (!viewer?.id) return false;
  if (viewer.role === "ADMIN") return true;
  return !!salon.assignedToId && salon.assignedToId === viewer.id;
}
