import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";

/** Sets userProfile/{providerId}.featureAnnouncements.emailOptOut on the live (prod-eu) database. */
export async function optOutOfDigest(providerId: string): Promise<void> {
  await getDb()
    .collection("userProfile")
    .doc(providerId)
    .set(
      { featureAnnouncements: { emailOptOut: true, emailOptOutAt: FieldValue.serverTimestamp() } },
      { merge: true },
    );
}
