import { getDb } from "@/lib/firebase-admin";

export type InboxConfig = {
  token: string;
  accountId: string;
  version: string;
  host: "graph.instagram.com" | "graph.facebook.com";
  ownerIds: string[];
  username?: string;
  providerId?: string;
};

// Firebase owns token renewal and webhook delivery. Read its private vault at
// request time; do not duplicate a rotating token in the CRM environment.
export async function inboxConfig(): Promise<InboxConfig | null> {
  const providerId = process.env.CRM_INSTAGRAM_PROVIDER_ID?.trim();
  if (providerId) {
    const db = getDb();
    const [profileDoc, credentialsDoc] = await Promise.all([
      db.collection("userProfile").doc(providerId).get(),
      db.collection("instagramCredentials").doc(providerId).get(),
    ]);
    const profile = profileDoc.data();
    const credentials = credentialsDoc.data();
    const username = String(profile?.instagramUsername ?? "").replace(/^@/, "").toLowerCase();
    if (!profile?.instagramConnected || username !== "glaura.app") return null;
    const token = credentials?.accessToken;
    const accountId = credentials?.instagramUserId || profile.instagramUserId;
    if (typeof token !== "string" || !token.trim() || token === "__managed__" || typeof accountId !== "string" || !accountId) return null;
    return { token, accountId, host: "graph.instagram.com", version: "v23.0", username, providerId,
      ownerIds: [...new Set([accountId, profile.instagramUserId, profile.instagramBusinessAccountId].filter((id): id is string => typeof id === "string" && !!id))],
    };
  }
  // Compatibility for a separately configured Facebook Login connection.
  const token = process.env.IG_MESSAGING_TOKEN;
  const accountId = process.env.IG_GRAPH_USER_ID;
  const version = process.env.IG_GRAPH_VERSION ?? "v25.0";
  return token && accountId && /^v\d+\.\d+$/.test(version)
    ? { token, accountId, version, host: "graph.facebook.com", ownerIds: [accountId] } : null;
}

export async function metaRequest<T>(path: string, options?: { method: "POST"; body: unknown }, connection?: InboxConfig): Promise<T> {
  const config = connection ?? await inboxConfig();
  if (!config) throw new Error("La connexion de messagerie Instagram n’est pas configurée.");
  const url = new URL(`https://${config.host}/${config.version}/${path}`);
  const response = await fetch(url, { method: options?.method ?? "GET", headers: { Authorization: `Bearer ${config.token}`, ...(options ? { "Content-Type": "application/json" } : {}) }, ...(options ? { body: JSON.stringify(options.body) } : {}), cache: "no-store", signal: AbortSignal.timeout(20000), redirect: "error" });
  if (!response.ok) throw new Error("Meta a refusé la demande. Vérifiez les permissions de messagerie et la validité de la connexion.");
  return response.json() as Promise<T>;
}
