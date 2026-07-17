import { readFileSync } from "node:fs";
import type { IgProfile } from "@/lib/prospection/ig-match";

// Minimal Instagram web-API client for salon enrichment.
// Auth = the session cookies of a logged-in IG account, exported in Netscape
// cookies.txt format (env IG_COOKIES_PATH — the file is gitignored, never
// commit it). Endpoints are the same ones the instagram.com SPA calls.

const IG_APP_ID = "936619743392459";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export class IgAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgAuthError";
  }
}

// Search endpoints are gated harder than profile reads: a session can read
// profiles fine while topsearch 401s. Not fatal — enrichment falls back to
// guessed handles. A fresh cookie export usually restores search.
export class IgSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgSearchUnavailableError";
  }
}

// Parse a Netscape cookies.txt into a Cookie header for instagram.com.
export function cookieHeaderFromNetscape(content: string): string {
  const jar = new Map<string, string>();
  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/^#HttpOnly_/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const [domain, , , , , name, value] = parts;
    if (!domain.includes("instagram.com") || !name) continue;
    jar.set(name, value.trim());
  }
  if (!jar.get("sessionid")) {
    throw new IgAuthError("Cookies Instagram sans sessionid — ré-exporte les cookies d'une session connectée.");
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function loadIgCookieHeader(): string {
  const path = process.env.IG_COOKIES_PATH;
  if (!path) throw new IgAuthError("IG_COOKIES_PATH non défini (fichier cookies.txt Netscape).");
  return cookieHeaderFromNetscape(readFileSync(path, "utf-8"));
}

async function igFetch(url: string, cookieHeader: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      "x-ig-app-id": IG_APP_ID,
      cookie: cookieHeader,
      accept: "*/*",
      "accept-language": "fr-FR,fr;q=0.9",
      referer: "https://www.instagram.com/",
      // Node's fetch sends sec-fetch-mode without the rest, which trips
      // Instagram's "SecFetch Policy violation" — mimic a same-origin XHR.
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    },
    redirect: "manual", // a redirect to /accounts/login means the session is dead
    signal: AbortSignal.timeout(20_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new IgAuthError(`Instagram a refusé la session (HTTP ${response.status}).`);
  }
  if (response.status === 429) {
    throw new IgAuthError("Rate-limit Instagram (429) — réessaie plus tard.");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new IgAuthError("Session Instagram expirée (redirection login) — ré-exporte les cookies.");
  }
  if (!response.ok) throw new Error(`Instagram HTTP ${response.status} sur ${url}`);

  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new IgAuthError("Réponse Instagram non-JSON (checkpoint/challenge probable).");
  }
}

type JsonObject = Record<string, unknown>;
const asObject = (v: unknown): JsonObject => (typeof v === "object" && v !== null ? (v as JsonObject) : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type IgSearchHit = { username: string; fullName: string | null; isVerified: boolean };

// Search accounts by salon name (same endpoint as the site's search box).
// Throws IgSearchUnavailableError when the session can't use search (the
// caller falls back to guessed handles); rate limits still bubble up.
export async function searchAccounts(query: string, cookieHeader: string): Promise<IgSearchHit[]> {
  const url = `https://www.instagram.com/api/v1/web/search/topsearch/?context=blended&query=${encodeURIComponent(query)}&include_reel=false`;
  let raw: unknown;
  try {
    raw = await igFetch(url, cookieHeader);
  } catch (error) {
    if (error instanceof Error && /429/.test(error.message)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new IgSearchUnavailableError(`Recherche Instagram indisponible (${message})`);
  }
  const data = asObject(raw);
  return asArray(data.users)
    .map((entry) => asObject(asObject(entry).user))
    .map((user) => ({
      username: asString(user.username) ?? "",
      fullName: asString(user.full_name),
      isVerified: user.is_verified === true,
    }))
    .filter((hit) => hit.username);
}

// Full profile (followers, bio, links, business info) for cross-validation.
export async function fetchProfile(username: string, cookieHeader: string): Promise<IgProfile | null> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  let data: JsonObject;
  try {
    data = asObject(await igFetch(url, cookieHeader));
  } catch (error) {
    // Instagram answers 404 or 400 for unknown/invalid usernames.
    if (error instanceof Error && /HTTP (400|404)/.test(error.message)) return null;
    throw error;
  }
  const user = asObject(asObject(data.data).user);
  if (!asString(user.username)) return null;

  const bioLinks = [
    asString(user.external_url),
    ...asArray(user.bio_links).map((link) => asString(asObject(link).url)),
  ].filter((link): link is string => Boolean(link));

  return {
    username: asString(user.username)!,
    fullName: asString(user.full_name),
    followers: asNumber(asObject(user.edge_followed_by).count),
    biography: asString(user.biography),
    bioLinks: [...new Set(bioLinks)],
    categoryName: asString(user.category_name),
    isPrivate: user.is_private === true,
    businessAddress: asString(user.business_address_json),
  };
}

// Jittered pacing between Instagram calls (keeps the account under the radar).
export function igDelayMs(): number {
  const base = Number(process.env.PROSPECT_IG_DELAY_MS);
  const ms = Number.isFinite(base) && base >= 0 ? base : 10_000;
  return Math.round(ms * (0.7 + Math.random() * 0.6)); // ±30% jitter
}
