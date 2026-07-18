import type { IgProfile } from "@/lib/prospection/ig-match";

// Instagram Business Discovery provider (Graph API).
// Looks up a PUBLIC Business/Creator account by username from our own IG
// business account (@glaura.app). Official, no personal cookies, runs from
// any IP (VPS included). Returns the same IgProfile shape the cross-validation
// scorer consumes — the `website` field maps to bioLinks (the salon's booking
// link in bio = our strongest signal).
//
// Auth: a Page access token with instagram_basic + instagram_manage_insights
// (env IG_GRAPH_TOKEN) + our IG business user id (env IG_GRAPH_USER_ID).

const GRAPH_VERSION = "v21.0";

export class IgGraphAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgGraphAuthError";
  }
}

export class IgGraphRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgGraphRateLimitError";
  }
}

// Graph error codes that mean "stop the run" rather than "this handle is bad".
const AUTH_CODES = new Set([190, 102, 10, 200, 803]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

type GraphError = { message: string; code?: number; error_subcode?: number };

export type IgGraphConfig = { token: string; userId: string };

export function igGraphConfig(): IgGraphConfig | null {
  const token = process.env.IG_GRAPH_TOKEN;
  const userId = process.env.IG_GRAPH_USER_ID;
  return token && userId ? { token, userId } : null;
}

const FIELDS = "username,name,followers_count,media_count,biography,website";

// Look up one handle. Returns null when the account doesn't exist or isn't a
// Business/Creator account (both are "not found" for our purposes).
export async function businessDiscovery(handle: string, config: IgGraphConfig): Promise<IgProfile | null> {
  const fields = `business_discovery.username(${handle}){${FIELDS}}`;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${config.userId}?fields=${encodeURIComponent(fields)}&access_token=${config.token}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = (await response.json()) as {
    business_discovery?: {
      username?: string;
      name?: string;
      followers_count?: number;
      media_count?: number;
      biography?: string;
      website?: string;
    };
    error?: GraphError;
  };

  if (body.error) {
    const { code, message } = body.error;
    if (code != null && AUTH_CODES.has(code)) throw new IgGraphAuthError(`Graph API: ${message} (code ${code})`);
    if (code != null && RATE_LIMIT_CODES.has(code)) throw new IgGraphRateLimitError(`Graph API rate-limit (code ${code})`);
    // code 110 / subcode 2207013 = "Invalid user id" (unknown handle or not a
    // business account) — a normal miss, not an error.
    return null;
  }

  const bd = body.business_discovery;
  if (!bd?.username) return null;

  return {
    username: bd.username,
    fullName: bd.name ?? null,
    followers: typeof bd.followers_count === "number" ? bd.followers_count : null,
    biography: bd.biography ?? null,
    bioLinks: bd.website ? [bd.website] : [],
    categoryName: null, // not exposed by business_discovery
    isPrivate: false, // discovery only returns public business accounts
    businessAddress: null, // not exposed; location comes from biography
  };
}
