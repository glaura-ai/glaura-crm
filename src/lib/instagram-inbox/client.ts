// Facebook Login integration, using the Page token associated with Glaura's IG account.
export function inboxConfig() {
  const token = process.env.IG_MESSAGING_TOKEN;
  const accountId = process.env.IG_GRAPH_USER_ID;
  const version = process.env.IG_GRAPH_VERSION ?? "v25.0";
  return token && accountId && /^v\d+\.\d+$/.test(version) ? { token, accountId, version } : null;
}
export async function metaRequest<T>(path: string, options?: { method: "POST"; body: unknown }): Promise<T> {
  const config = inboxConfig();
  if (!config) throw new Error("La connexion de messagerie Instagram n’est pas configurée.");
  const url = new URL(`https://graph.facebook.com/${config.version}/${path}`);
  const response = await fetch(url, { method: options?.method ?? "GET", headers: { Authorization: `Bearer ${config.token}`, ...(options ? { "Content-Type": "application/json" } : {}) }, ...(options ? { body: JSON.stringify(options.body) } : {}), cache: "no-store", signal: AbortSignal.timeout(20000), redirect: "error" });
  if (!response.ok) throw new Error("Meta a refusé la demande. Vérifiez les permissions de messagerie et la validité de la connexion.");
  return response.json() as Promise<T>;
}
