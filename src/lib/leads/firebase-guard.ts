// Guard for hard-deleting a CRM lead that may own a Glaura (Firebase Auth)
// account: onboarding jobs record the uid, Laura trials create the account on
// the lead's email. Deleting the lead while that account is live would orphan a
// working salon login, so it must be disabled first and the deletion confirmed.

export type LinkedFirebaseAccount = { uid: string; email: string | null; disabled: boolean };

type AuthLike = {
  getUser(uid: string): Promise<{ uid: string; email?: string; disabled: boolean }>;
  getUserByEmail(email: string): Promise<{ uid: string; email?: string; disabled: boolean }>;
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
): Promise<LinkedFirebaseAccount[]> {
  const uids = [...new Set(refs.uids.filter((u): u is string => !!u))];
  const emails = [...new Set(refs.emails.map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e))];
  const users = await Promise.all([
    ...uids.map((uid) => lookup(() => auth.getUser(uid))),
    ...emails.map((email) => lookup(() => auth.getUserByEmail(email))),
  ]);
  const byUid = new Map<string, LinkedFirebaseAccount>();
  for (const u of users) if (u && !byUid.has(u.uid)) byUid.set(u.uid, { uid: u.uid, email: u.email ?? null, disabled: u.disabled });
  return [...byUid.values()];
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
    return `Compte Glaura actif (${who}) : désactive-le dans Firebase avant de supprimer ce lead.`;
  }
  const normalize = (s: string) => s.trim().toLowerCase();
  if (!confirmName || normalize(confirmName) !== normalize(salonName)) {
    return "Confirmation requise : saisis le nom exact du salon pour supprimer un lead lié à un compte Glaura.";
  }
  return null;
}
