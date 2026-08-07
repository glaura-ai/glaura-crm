import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import type { ProIdentityResult } from "./pro-identity";

/** Keeps the OAuth-created skeleton private while a human checks ownership. */
export async function holdProProfileForIdentityReview(
  uid: string,
  identity: ProIdentityResult,
): Promise<void> {
  await getDb().collection("userProfile").doc(uid).set({
    enable: false,
    isActive: false,
    available: false,
    proOnboardingStatus: "identity_review",
    proIdentityVerification: {
      status: identity.status,
      score: identity.score,
      requiredScore: identity.requiredScore,
      signals: identity.signals,
      bookingClaim: identity.bookingClaim,
      checkedAtMs: Date.now(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
