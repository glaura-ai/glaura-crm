import { chromium, type Browser, type BrowserContext } from "playwright";

// Resolve Instagram reel permalinks to directly-downloadable MP4 URLs WITHOUT
// Instagram cookies, by driving a real headless Chromium through saveinsta.to.
//
// Why a browser and not plain HTTP (as the old kit tried):
//   - yt-dlp / gallery-dl now require a logged-in IG session ("empty media
//     response" otherwise) — not cookie-free.
//   - snapinsta.to sits behind a hard Cloudflare challenge (403 on every HTTP
//     request). saveinsta.to serves a normal page (200) to a real browser, and
//     its JS handles the userverify/token dance for us, so a driven Chromium
//     clears Cloudflare that a flat POST cannot.
//
// saveinsta's result renders two links with identical markup — "Download
// Thumbnail" and "Download Video" — so we select strictly by the video label.
// The returned dl.snapcdn.app URL is short-lived, but seedOnboardingVideos
// fetches it within seconds, so expiry is a non-issue.
//
// This reuses the same Playwright/Chromium the onboarding worker already runs
// for expandSalonPage; honour PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH when set.

const SAVEINSTA_URL = "https://saveinsta.to/en";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const NAV_TIMEOUT_MS = 45_000;
const INPUT_TIMEOUT_MS = 15_000;
const RESULT_TIMEOUT_MS = 40_000;

export type ResolveMethod = "saveinsta";
export type ResolvedReel = { videoUrl: string; method: ResolveMethod };

export class ReelResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReelResolveError";
  }
}

export interface ReelResolver {
  /** Resolve one reel permalink to an MP4 URL. Throws ReelResolveError on failure. */
  resolve(permalink: string): Promise<ResolvedReel>;
  /** Tear down the shared browser. Always call in a finally. */
  close(): Promise<void>;
}

/**
 * Open a resolver backed by one long-lived Chromium instance. Resolving many
 * reels through a single browser (one fresh page each) avoids paying the
 * launch cost per reel.
 */
export async function openReelResolver(): Promise<ReelResolver> {
  const browser: Browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const context: BrowserContext = await browser.newContext({ userAgent: USER_AGENT });

  async function resolve(permalink: string): Promise<ResolvedReel> {
    const page = await context.newPage();
    try {
      await page.goto(SAVEINSTA_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

      const input = page.locator('input[type="text"], input[name="url"]').first();
      await input.waitFor({ timeout: INPUT_TIMEOUT_MS });
      await input.fill(permalink);

      const submit = page.getByRole("button", { name: /download|search/i }).first();
      await submit.click({ timeout: 10_000 }).catch(() => page.keyboard.press("Enter"));

      // Select the video link strictly by label — "Download Thumbnail" shares
      // its markup and would otherwise resolve to a JPEG.
      const videoLink = page.getByRole("link", { name: /download video/i }).first();
      await videoLink.waitFor({ timeout: RESULT_TIMEOUT_MS });

      const href = await videoLink.getAttribute("href");
      if (!href) throw new ReelResolveError("lien « Download Video » sans href");
      return { videoUrl: href.replace(/&amp;/g, "&"), method: "saveinsta" };
    } catch (error) {
      if (error instanceof ReelResolveError) throw error;
      throw new ReelResolveError(message(error));
    } finally {
      await page.close().catch(() => {});
    }
  }

  async function close(): Promise<void> {
    await browser.close().catch(() => {});
  }

  return { resolve, close };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type Mp4Check = {
  ok: boolean;
  contentType: string | null;
  totalBytes: number | null;
  fetchedBytes: number;
  error?: string;
};

/**
 * Confirm a resolved URL actually serves a video — the exact check
 * seedOnboardingVideos' server-side download would face. Fetches only the first
 * ~1 MB (Range) and inspects the content-type + MP4 `ftyp` magic bytes, so it's
 * cheap enough to run on every reel in a dry-run.
 */
export async function verifyMp4Url(url: string): Promise<Mp4Check> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Glaura/1.0", range: "bytes=0-1048575" },
      signal: AbortSignal.timeout(30_000),
    });
    const contentType = res.headers.get("content-type");
    const range = res.headers.get("content-range"); // e.g. "bytes 0-1048575/4862623"
    const totalBytes = range ? Number(range.split("/")[1]) || null : null;
    if (!res.ok) {
      return { ok: false, contentType, totalBytes, fetchedBytes: 0, error: `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const isMp4 = buf.subarray(4, 8).toString("ascii") === "ftyp";
    const looksVideo = isMp4 || (contentType?.includes("video") ?? false);
    return { ok: looksVideo, contentType, totalBytes, fetchedBytes: buf.length };
  } catch (error) {
    return { ok: false, contentType: null, totalBytes: null, fetchedBytes: 0, error: message(error) };
  }
}
