// Guard for hard-deleting a CRM lead that may own a Glaura (Firebase Auth)
// account: onboarding jobs record the uid, Laura trials create the account on
// the lead's email. "Disabled" matches the admin's Activate toggle — the
// Firestore `userProfile.enable` / `isActive` flags, not the Firebase Auth login
// switch. A lead whose salon is still activated can't be deleted; otherwise the
// deletion needs the salon name typed back.

export type LinkedFirebaseAccount = { uid: string; email: string | null; disabled: boolean };

/** True when the admin's activation flag is on for this uid's userProfile. */
export type IsAdminEnabled = (uid: string) => Promise<boolean>;

type AuthLike = {
  getUser(uid: string): Promise<{ uid: string; email?: string }>;
  getUserByEmail(email: string): Promise<{ uid: string; email?: string }>;
};

const isNotFound = (error: unknown) =>
  (error as { code?: string } | null)?.code === "auth/user-not-found";

async function lookup(fn: () => ReturnType<AuthLike["getUser"]>) {
  try {
    return await fn();
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function findLinkedFirebaseAccounts(
  refs: { uids: (string | null)[]; emails: (string | null)[] },
  auth: AuthLike,
  isAdminEnabled: IsAdminEnabled,
): Promise<LinkedFirebaseAccount[]> {
  const uids = [...new Set(refs.uids.filter((u): u is string => !!u))];
  const emails = [...new Set(refs.emails.map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e))];
  const users = await Promise.all([
    ...uids.map((uid) => lookup(() => auth.getUser(uid))),
    ...emails.map((email) => lookup(() => auth.getUserByEmail(email))),
  ]);
  const byUid = new Map<string, { uid: string; email: string | null }>();
  for (const u of users) if (u && !byUid.has(u.uid)) byUid.set(u.uid, { uid: u.uid, email: u.email ?? null });
  return Promise.all([...byUid.values()].map(async (a) => ({ ...a, disabled: !(await isAdminEnabled(a.uid)) })));
}

/** Returns a French error message when deletion must not proceed, null otherwise. */
export function salonDeleteBlocker(
  accounts: LinkedFirebaseAccount[],
  salonName: string,
  confirmName: string | undefined,
): string | null {
  if (accounts.length === 0) return null;
  const active = accounts.filter((a) => !a.disabled);
  if (active.length > 0) {
    const who = active.map((a) => a.email ?? a.uid).join(", ");
    return `Compte Glaura actif (${who}) : désactive-le dans l'admin avant de supprimer ce lead.`;
  }
  const normalize = (s: string) => s.trim().toLowerCase();
  if (!confirmName || normalize(confirmName) !== normalize(salonName)) {
    return "Confirmation requise : saisis le nom exact du salon pour supprimer un lead lié à un compte Glaura.";
  }
  return null;
}
