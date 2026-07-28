/**
 * PURE authorization predicate for onboarded-account credentials.
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

/**
 * Who may reveal an onboarded salon account's password: any signed-in CRM user.
 *
 * Deliberately NOT scoped to the assigned commercial. The CRM is an internal
 * staff tool, reps cover for each other on demos, and every reveal is already
 * audit-logged — so per-salon ownership would mostly block colleagues mid-call
 * while doing nothing about the actual risk (a shared or stolen CRM session).
 *
 * Authentication is therefore the whole gate: keep the `!viewer?.id` check
 * strict, since an anonymous caller must never reach the decrypt path.
 *
 * Narrows to a viewer with a usable `id` so the caller can attribute the audit
 * event without re-checking (or asserting) that one exists.
 */
export function canRevealOnboardingPassword(
  viewer: CredentialViewer | null | undefined,
): viewer is CredentialViewer & { id: string } {
  return !!viewer?.id;
}
