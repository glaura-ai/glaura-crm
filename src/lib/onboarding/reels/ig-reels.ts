import { igGraphConfig, type IgGraphConfig } from "@/lib/prospection/ig-graph";

// Fetch a salon's most-liked video reels via the Graph API Business Discovery
// `media` edge. Official + cookie-free (same IG_GRAPH_TOKEN / IG_GRAPH_USER_ID
// the prospection enrichment already uses), so it runs from the VPS.
//
// Limits worth knowing: the media edge is chronological and deep pagination is
// broken, so we pull one page of the most recent media.
// `media_url` is withheld for reels with licensed music or downloads turned off;
// when present it is used directly, otherwise the permalink is resolved (resolve.ts).

const GRAPH_VERSION = "v25.0";

// How many recent media items to pull. One page only (pagination is broken on
// this edge); 50 covers months of posts for a typical salon.
const MEDIA_PAGE_LIMIT = 50;

// media_type values that carry a playable video.
const VIDEO_MEDIA_TYPES = new Set(["VIDEO", "REELS", "CAROUSEL_VIDEO"]);

export type Reel = {
  instagramVideoId: string;
  caption: string;
  permalink: string;
  thumbnailUrl: string | null;
  /** Direct MP4 from the Graph API, when Meta exposes it. */
  mediaUrl: string | null;
  timestamp: string | null;
  likeCount: number;
};

type GraphMediaItem = {
  id?: string;
  caption?: string;
  media_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp?: string;
  like_count?: number;
};

type GraphMediaResponse = {
  business_discovery?: { media?: { data?: GraphMediaItem[] } };
  error?: { message: string; code?: number };
};

/**
 * Return every video reel among a salon's most recent media (API order,
 * newest first). Picking which ones to seed is select.ts's job.
 *
 * @param handle Bare Instagram username (no @, no URL).
 */
export async function fetchRecentReels(
  handle: string,
  config: IgGraphConfig,
): Promise<Reel[]> {
  const mediaFields = "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count";
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
        mediaUrl: it.media_url ?? null,
        timestamp: it.timestamp ?? null,
        likeCount: typeof it.like_count === "number" ? it.like_count : 0,
      }),
    );
}

export { igGraphConfig };
export type { IgGraphConfig };
