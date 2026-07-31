import "server-only";

import { getAuth, getDb } from "@/lib/firebase-admin";
import { maybeSendMagicLinkEmail } from "@/lib/onboarding/magic-link";
import { slugify } from "@/lib/slugs";
import { buildLauraUserProfile, type LauraAccountInput } from "@/lib/leads/laura-account";

/**
 * Creates the Glaura account behind a Laura lead and emails the salon a way in.
 *
 * Never throws: a lead is captured in Airtable and the CRM regardless, and a
 * salon that filled in a form must not see an error because account creation
 * had a bad minute. Failures are returned for the caller to log.
 *
 * Idempotent on the login email — a salon that submits twice gets one account
 * and one fresh link, never a duplicate or a collision error.
 */

export type LauraProvisionResult =
  | { status: "created"; uid: string; emailSent: boolean; emailError?: string }
  | { status: "existing"; uid: string; emailSent: boolean; emailError?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export async function provisionLauraAccount(
  input: LauraAccountInput,
): Promise<LauraProvisionResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { status: "skipped", reason: "no_email" };

  const auth = getAuth();
  const db = getDb();
  const now = new Date();

  // Already a Glaura account on this email? Re-send the link rather than
  // colliding — the salon is asking for access either way.
  try {
    const existing = await auth.getUserByEmail(email);
    const mail = await maybeSendMagicLinkEmail({
      email,
      salonName: input.salonName,
      uid: existing.uid,
    });
    return {
      emailError: mail.error,
      emailSent: mail.sent,
      status: "existing",
      uid: existing.uid,
    };
  } catch {
    // Not found — fall through and create.
  }

  let uid: string;
  try {
    const created = await auth.createUser({
      disabled: false,
      displayName: input.salonName,
      email,
      // No password: access is by magic link, so none ever travels by email.
      emailVerified: false,
    });
    uid = created.uid;
  } catch (error) {
    return {
      error: `auth user creation failed: ${error instanceof Error ? error.message : String(error)}`,
      status: "failed",
    };
  }

  try {
    const companyUserName = await reserveCompanyUserName(db, slugify(input.salonName) || "salon");
    await db
      .collection("userProfile")
      .doc(uid)
      .set(buildLauraUserProfile(input, { companyUserName, now, uid }));
  } catch (error) {
    // The auth user exists but has no profile — it cannot sign in usefully.
    // Remove it so a retry is clean rather than hitting the "existing" branch
    // above and emailing a link into a broken account.
    await auth.deleteUser(uid).catch(() => {});
    return {
      error: `profile write failed: ${error instanceof Error ? error.message : String(error)}`,
      status: "failed",
    };
  }

  const mail = await maybeSendMagicLinkEmail({ email, salonName: input.salonName, uid });
  return { emailError: mail.error, emailSent: mail.sent, status: "created", uid };
}

/** First free `companyUserName`, which the portal turns into the public URL. */
async function reserveCompanyUserName(
  db: ReturnType<typeof getDb>,
  base: string,
): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    const clash = await db
      .collection("userProfile")
      .where("companyUserName", "==", candidate)
      .limit(1)
      .get();
    if (clash.empty) return candidate;
  }
  // Fall back to something guaranteed unique rather than failing the signup.
  return `${base}-${Date.now().toString(36)}`;
}
