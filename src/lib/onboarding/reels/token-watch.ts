import type { IgGraphConfig } from "./ig-reels";

// Daily health check of the Instagram Graph token used for reels and
// prospection. A dead token makes both fail silently, so the onboarding
// worker runs this from its poll loop and emails the team while it is broken.

const GRAPH_VERSION = "v25.0";
export const TOKEN_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type TokenCheck = { ok: true } | { ok: false; reason: string };

export async function checkIgGraphToken(
  config: IgGraphConfig | null,
  fetcher: typeof fetch = fetch,
): Promise<TokenCheck> {
  if (!config) return { ok: false, reason: "IG_GRAPH_TOKEN / IG_GRAPH_USER_ID non définis" };
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${config.userId}?fields=id&access_token=${config.token}`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
  const body = (await response.json()) as { id?: string; error?: { message: string; code?: number } };
  if (body.error) return { ok: false, reason: `${body.error.message} (code ${body.error.code ?? "?"})` };
  return body.id ? { ok: true } : { ok: false, reason: `réponse inattendue (HTTP ${response.status})` };
}

/** A tick to call from a poll loop: checks once per interval, never throws. */
export function createTokenWatch(deps: {
  check: () => Promise<TokenCheck>;
  notify: (reason: string) => Promise<void>;
  intervalMs?: number;
  now?: () => number;
}): () => Promise<void> {
  const intervalMs = deps.intervalMs ?? TOKEN_CHECK_INTERVAL_MS;
  const now = deps.now ?? Date.now;
  let lastCheckAt: number | null = null;

  return async () => {
    if (lastCheckAt !== null && now() - lastCheckAt < intervalMs) return;
    lastCheckAt = now();
    try {
      const result = await deps.check();
      if (!result.ok) await deps.notify(result.reason);
    } catch (error) {
      console.error("IG token watch failed:", error);
    }
  };
}
