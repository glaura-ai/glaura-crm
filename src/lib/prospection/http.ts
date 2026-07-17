const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 30_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function throttleMs(): number {
  const parsed = Number(process.env.PROSPECT_SWEEP_DELAY_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1500;
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} on ${url}`);
    this.name = "HttpStatusError";
  }
}

// Fetch a directory page as HTML. Follows redirects; retries once on 5xx/network errors.
export async function fetchHtml(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(3000);
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, "accept-language": "fr-FR,fr;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status >= 500) {
        lastError = new HttpStatusError(response.status, url);
        continue;
      }
      if (!response.ok) throw new HttpStatusError(response.status, url);
      return await response.text();
    } catch (error) {
      if (error instanceof HttpStatusError && error.status < 500) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Échec du fetch ${url}`);
}
