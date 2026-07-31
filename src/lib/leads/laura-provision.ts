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
 *
 * The access email is NOT sent here. It is handed back as `sendAccessEmail` so
 * the caller can run it after responding: an inline SMTP handshake was the
 * single biggest part of the wait on a screen where the salon is watching a
 * spinner, and the account already exists by then — the email is a
 * notification, not a step.
 */

/** Sends the access email and resolves with what happened; never rejects. */
export type SendAccessEmail = () => Promise<{ sent: boolean; error?: string }>;

export type LauraProvisionResult =
  | { status: "created"; uid: string; sendAccessEmail: SendAccessEmail }
  | { status: "existing"; uid: string; sendAccessEmail: SendAccessEmail }
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
    return {
      sendAccessEmail: accessEmailFor(existing.uid, email, input.salonName),
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

  return { sendAccessEmail: accessEmailFor(uid, email, input.salonName), status: "created", uid };
}

function accessEmailFor(uid: string, email: string, salonName: string): SendAccessEmail {
  return async () => {
    const mail = await maybeSendMagicLinkEmail({ email, salonName, uid });
    return { error: mail.error, sent: mail.sent };
  };
}

/**
 * First free `companyUserName`, which the portal turns into the public URL.
 *
 * One prefix query rather than a query per candidate: the old loop cost a round
 * trip for every name already taken, on a request the salon is waiting on.
 */
async function reserveCompanyUserName(
  db: ReturnType<typeof getDb>,
  base: string,
): Promise<string> {
  const snap = await db
    .collection("userProfile")
    .where("companyUserName", ">=", base)
    // \uf8ff sorts above any character Firestore stores, so the range covers
    // exactly the names starting with `base` and nothing beyond them.
    .where("companyUserName", "<", `${base}\uf8ff`)
    .select("companyUserName")
    .get();

  const taken = new Set(snap.docs.map((doc) => doc.get("companyUserName") as string));

  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Fall back to something guaranteed unique rather than failing the signup.
  return `${base}-${Date.now().toString(36)}`;
}
