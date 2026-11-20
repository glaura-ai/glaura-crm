import type { ProIdentityResult } from "./pro-identity";

type ClaimResult = { claimed: boolean };

/**
 * Applies the booking-URL claim to a verified identity. A `laura_demo` preview
 * never claims the URL (a prank demo must not block the real owner; the claim
 * happens at activation) and can therefore never be held for a claim conflict.
 */
export async function applyBookingClaim(
  identity: ProIdentityResult,
  options: {
    identityChannel?: string | null;
    bypass: boolean;
    claim: (bookingClaim: string | null, options: { bypass: boolean }) => Promise<ClaimResult>;
  },
): Promise<ProIdentityResult> {
  if (identity.status !== "verified" || options.identityChannel === "laura_demo") return identity;
  const claim = await options.claim(identity.bookingClaim, { bypass: options.bypass });
  if (claim.claimed) return identity;
  return {
    ...identity,
    status: "review_required",
    signals: [...identity.signals, "booking_claim_conflict"],
  };
}
