import { igGraphConfig, type IgGraphConfig } from "@/lib/prospection/ig-graph";

// Fetch a salon's most-liked video reels via the Graph API Business Discovery
// `media` edge. Official + cookie-free (same IG_GRAPH_TOKEN / IG_GRAPH_USER_ID
// the prospection enrichment already uses), so it runs from the VPS.
//
// Limits worth knowing: the media edge is chronological and deep pagination is
// broken, so we pull one page of the most recent media and sort it by
// like_count — i.e. "the most-liked among recent posts", not the all-time top.
// `media_url` for a third-party account is unreliable/null, so we only keep the
// `permalink` here; the actual MP4 URL is resolved later (see resolve.ts).

const GRAPH_VERSION = "v21.0";

// How many recent media items to pull before sorting by likes. One page only
// (pagination is broken on this edge); 50 is plenty to find the top reels.
const MEDIA_PAGE_LIMIT = 50;

// media_type values that carry a playable video.
const VIDEO_MEDIA_TYPES = new Set(["VIDEO", "REELS", "CAROUSEL_VIDEO"]);

export type Reel = {
  instagramVideoId: string;
  caption: string;
  permalink: string;
  thumbnailUrl: string | null;
  timestamp: string | null;
  likeCount: number;
};

type GraphMediaItem = {
  id?: string;
  caption?: string;
  media_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  timestamp?: string;
  like_count?: number;
};

type GraphMediaResponse = {
  business_discovery?: { media?: { data?: GraphMediaItem[] } };
  error?: { message: string; code?: number };
};

/**
 * Return a salon's video reels, most-liked first, from its most recent media.
 *
 * @param handle Bare Instagram username (no @, no URL).
 * @param limit  Max reels to return (caller caps at seed budget, e.g. 5).
 */
export async function fetchTopReels(
  handle: string,
  limit: number,
  config: IgGraphConfig,
): Promise<Reel[]> {
  const mediaFields = "id,caption,media_type,permalink,thumbnail_url,timestamp,like_count";
  const fields = `business_discovery.username(${handle}){media.limit(${MEDIA_PAGE_LIMIT}){${mediaFields}}}`;
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${config.userId}` +
    `?fields=${encodeURIComponent(fields)}&access_token=${config.token}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = (await response.json()) as GraphMediaResponse;

  if (body.error) {
    throw new Error(`Graph API: ${body.error.message} (code ${body.error.code ?? "?"})`);
  }

  const items = body.business_discovery?.media?.data ?? [];
  return items
    .filter((it) => it.id && it.permalink && VIDEO_MEDIA_TYPES.has(it.media_type ?? ""))
    .map(
      (it): Reel => ({
        instagramVideoId: it.id!,
        caption: it.caption ?? "",
        permalink: it.permalink!,
        thumbnailUrl: it.thumbnail_url ?? null,
        timestamp: it.timestamp ?? null,
        likeCount: typeof it.like_count === "number" ? it.like_count : 0,
      }),
    )
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, Math.max(1, limit));
}

export { igGraphConfig };
export type { IgGraphConfig };
