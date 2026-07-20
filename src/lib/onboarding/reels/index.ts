import { sleep } from "@/lib/prospection/http";
import { fetchTopReels, igGraphConfig, type Reel } from "@/lib/onboarding/reels/ig-reels";
import { openReelResolver, verifyMp4Url, type Mp4Check, type ResolveMethod } from "@/lib/onboarding/reels/resolve";
import { seedOnboardingVideos, type SeedReel, type SeedResult } from "@/lib/onboarding/reels/seed";

// Orchestrates the cold-onboarding reel pipeline for one salon:
//   Graph Business Discovery (most-liked, cookie-free)
//     → resolve each permalink to an MP4 URL (Playwright → saveinsta.to)
//       → seedOnboardingVideos (R2 upload + auto service-detection).
// Service detection lives in the Cloud Function, so nothing here maps captions
// to services — we only supply the reels.
//
// Two modes:
//   - Live: seeds resolved reels into the salon's feed (needs uid + secret).
//   - Dry-run: fetch + resolve (+ optional MP4 verification), NO seed, NO prod
//     writes. Accepts explicit --permalinks to skip Business Discovery, so it
//     runs without the Graph token (e.g. on a laptop).

// Never seed more than the Cloud Function accepts, whatever the caller asks.
const MAX_REELS = 5;

// Jittered spacing between reel resolutions to stay gentle on saveinsta.
const RESOLVE_SPACING_MS = 1500;

export type ReelRow = {
  instagramVideoId: string;
  permalink: string;
  likeCount: number;
  caption: string;
  method: ResolveMethod | null;
  videoUrl: string | null;
  verify: Mp4Check | null;
  error: string | null;
};

export type OnboardReelsResult = {
  handle: string;
  candidates: number; // reels found (via BD or supplied)
  resolved: number; // reels whose MP4 URL we obtained
  dryRun: boolean;
  rows: ReelRow[]; // per-reel outcome, for reporting
  seed: SeedResult | null; // seedOnboardingVideos summary (null on dry-run / nothing seeded)
};

export type OnboardReelsOptions = {
  handle?: string; // required unless permalinks given
  uid?: string; // required for a live (non-dry) run
  limit?: number; // clamped to 1..MAX_REELS
  permalinks?: string[]; // bypass Business Discovery (dry-run without a token)
  dryRun?: boolean;
  verify?: boolean; // download-check each resolved URL is a real MP4
};

type Logger = (message: string) => void;

/**
 * Fetch (or accept) a salon's top reels, resolve each to an MP4 URL, then seed
 * them — or, in dry-run, report what would be seeded without writing.
 */
export async function onboardSalonReels(
  opts: OnboardReelsOptions,
  log: Logger = () => {},
): Promise<OnboardReelsResult> {
  const dryRun = opts.dryRun ?? false;
  const verify = opts.verify ?? false;
  const limit = Math.max(1, Math.min(MAX_REELS, opts.limit ?? MAX_REELS));

  const { handle, reels } = await collectReels(opts, limit, log);
  if (reels.length === 0) {
    return { handle, candidates: 0, resolved: 0, dryRun, rows: [], seed: null };
  }

  const rows: ReelRow[] = [];
  const seedReels: SeedReel[] = [];
  const resolver = await openReelResolver();
  try {
    for (const [index, reel] of reels.entries()) {
      const row: ReelRow = {
        instagramVideoId: reel.instagramVideoId,
        permalink: reel.permalink,
        likeCount: reel.likeCount,
        caption: reel.caption,
        method: null,
        videoUrl: null,
        verify: null,
        error: null,
      };
      try {
        const { videoUrl, method } = await resolver.resolve(reel.permalink);
        row.videoUrl = videoUrl;
        row.method = method;
        if (verify) {
          row.verify = await verifyMp4Url(videoUrl);
          log(
            `  ${reel.instagramVideoId} (${reel.likeCount} likes) → ${method} · ` +
              `${row.verify.ok ? "mp4 ok" : "PAS mp4"} ${fmtBytes(row.verify.totalBytes)}` +
              (row.verify.error ? ` (${row.verify.error})` : ""),
          );
        } else {
          log(`  ${reel.instagramVideoId} (${reel.likeCount} likes) → ${method}`);
        }
        seedReels.push({
          videoUrl,
          caption: reel.caption,
          instagramVideoId: reel.instagramVideoId,
          thumbnailUrl: reel.thumbnailUrl,
          timestamp: reel.timestamp,
        });
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
        log(`  ${reel.instagramVideoId} → non résolu: ${row.error}`);
      }
      rows.push(row);
      if (index < reels.length - 1) await sleep(RESOLVE_SPACING_MS);
    }
  } finally {
    await resolver.close();
  }

  if (dryRun) {
    log(`DRY-RUN: ${seedReels.length}/${reels.length} reel(s) résolus — aucun seed effectué`);
    return { handle, candidates: reels.length, resolved: seedReels.length, dryRun: true, rows, seed: null };
  }

  if (!opts.uid) throw new Error("uid requis pour le seed (utilise dryRun pour tester sans écrire).");
  if (seedReels.length === 0) {
    log("aucun reel résolu — rien à seeder");
    return { handle, candidates: reels.length, resolved: 0, dryRun: false, rows, seed: null };
  }

  const seed = await seedOnboardingVideos(opts.uid, seedReels);
  log(
    `seed: ${seed.synced} uploadé(s), ${seed.undetectedFallback} sans service détecté, ` +
      `${seed.alreadySynced} déjà présent(s), ${seed.hashDupes} doublon(s), ${seed.failed} échec(s)`,
  );
  return { handle, candidates: reels.length, resolved: seedReels.length, dryRun: false, rows, seed };
}

/** Build the reel list either from explicit permalinks or Business Discovery. */
async function collectReels(
  opts: OnboardReelsOptions,
  limit: number,
  log: Logger,
): Promise<{ handle: string; reels: Reel[] }> {
  if (opts.permalinks && opts.permalinks.length > 0) {
    const reels = opts.permalinks.slice(0, limit).map(reelFromPermalink);
    log(`${reels.length} reel(s) fournis explicitement (Business Discovery ignoré)`);
    return { handle: opts.handle ? normalizeHandle(opts.handle) : "(permalinks)", reels };
  }

  if (!opts.handle) throw new Error("handle requis (ou fournis des permalinks).");
  const config = igGraphConfig();
  if (!config) {
    throw new Error("IG_GRAPH_TOKEN / IG_GRAPH_USER_ID non définis — backend Graph requis (ou passe --permalinks).");
  }
  const handle = normalizeHandle(opts.handle);
  const reels = await fetchTopReels(handle, limit, config);
  log(`@${handle}: ${reels.length} reel(s) vidéo (top ${limit} par likes)`);
  return { handle, reels };
}

/** Accept "@salon", "salon", or a full instagram.com/<handle>/... URL. */
export function normalizeHandle(input: string): string {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/instagram\.com\/([^/?#]+)/i);
  const handle = fromUrl ? fromUrl[1] : trimmed;
  return handle.replace(/^@/, "").trim();
}

/** Synthesise a Reel from a bare permalink (dry-run without Business Discovery). */
function reelFromPermalink(permalink: string): Reel {
  const match = permalink.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i);
  return {
    instagramVideoId: match ? match[1] : permalink,
    caption: "",
    permalink,
    thumbnailUrl: null,
    timestamp: null,
    likeCount: 0,
  };
}

function fmtBytes(bytes: number | null): string {
  if (bytes == null) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
