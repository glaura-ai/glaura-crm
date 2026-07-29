/**
 * The account credentials behind a salon, for the « Compte prêt » email.
 *
 * The onboarding pipeline stores the login on whichever `OnboardingJob`
 * actually created the Firebase account — not necessarily the newest one, since
 * re-running onboarding logs an ALREADY_ONBOARDED job with a null password. The
 * salon page's reveal button already picks "the most recent job that has a
 * password"; this module is that same rule, shared so a resend cannot pick a
 * different job than the reveal shows.
 *
 * The plaintext password is deliberately behind its own call: the account
 * summary is safe to render in a page, the password is not — it is decrypted
 * only when an email is actually queued, and that decrypt is audited exactly
 * like a reveal.
 */

import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getDb } from "@/lib/firebase-admin";
import { welcomeEmailValues } from "@/lib/onboarding/welcome-email";

/** What the composer preview shows in place of the real credential. */
const MASKED_PASSWORD = "••••••••";

export type SalonAccount = {
  /** The job carrying the credential — the one a reveal/audit refers to. */
  jobId: string;
  loginEmail: string | null;
  accountUid: string | null;
};

/** The job that created the account, or null when the salon has no credential. */
export async function findCredentialJob(salonId: string): Promise<SalonAccount | null> {
  const job = await prisma.onboardingJob.findFirst({
    where: { salonId, loginPassword: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, loginEmail: true, accountUid: true },
  });
  if (!job) return null;
  return { jobId: job.id, loginEmail: job.loginEmail, accountUid: job.accountUid };
}

/**
 * Decrypts the credential of `jobId`. Throws on a rotated/missing
 * `ENCRYPTION_KEY` — the caller must not send an email with a blank password.
 */
export async function decryptJobPassword(jobId: string): Promise<string> {
  const job = await prisma.onboardingJob.findUnique({
    where: { id: jobId },
    select: { loginPassword: true },
  });
  if (!job?.loginPassword) throw new Error("Aucun mot de passe enregistré pour ce job d'onboarding");

  try {
    return decrypt(job.loginPassword);
  } catch {
    // Never surface the ciphertext or the crypto error itself.
    throw new Error("Déchiffrement impossible — vérifie ENCRYPTION_KEY sur le serveur");
  }
}

/**
 * Token values for the composer preview: real login and links, masked password.
 *
 * Returns null when the salon has no onboarded account, which is the composer's
 * signal that this template cannot be sent for this salon.
 */
export async function onboardingPreviewValues(
  salonId: string,
  salonName: string,
): Promise<Record<string, string> | null> {
  const account = await findCredentialJob(salonId);
  if (!account) return null;

  return welcomeEmailValues({
    email: account.loginEmail ?? "",
    password: MASKED_PASSWORD,
    companyUserName: await fetchCompanyUserName(account.accountUid),
    salonName,
  });
}

/**
 * `userProfile.companyUserName` — the public page slug, which the CRM does not
 * store. Best-effort: the email falls back to the generic site URL when
 * Firestore is unreachable, which is better than failing the send.
 */
export async function fetchCompanyUserName(accountUid: string | null | undefined): Promise<string | null> {
  if (!accountUid) return null;
  try {
    const snapshot = await getDb().collection("userProfile").doc(accountUid).get();
    const value = snapshot.get("companyUserName");
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}
