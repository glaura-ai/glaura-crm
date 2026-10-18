import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import { SAMPLE_PROVIDER_ID } from "./run";

/** Sets userProfile/{providerId}.featureAnnouncements.emailOptOut on the live (prod-eu) database. */
export async function optOutOfDigest(providerId: string): Promise<void> {
  // Test-email links must not opt out anyone.
  if (providerId === SAMPLE_PROVIDER_ID) return;
  await getDb()
    .collection("userProfile")
    .doc(providerId)
    .set(
      { featureAnnouncements: { emailOptOut: true, emailOptOutAt: FieldValue.serverTimestamp() } },
      { merge: true },
    );
}
