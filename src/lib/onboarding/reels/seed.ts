// Push resolved reels into the salon's Glaura video feed via the
// `seedOnboardingVideos` Cloud Function (goglow-firebase). The function owns
// everything downstream: downloads each videoUrl server-side, stores it on
// Cloudflare R2, auto-detects the matching service from the caption/hashtags
// (serviceDetector.js), dedups by IG id + content hash, and writes the
// `videos/{id}` Firestore doc — the same R2 path the mobile app uploads to.
//
// Auth is a shared pipeline secret (ONBOARDING_SEED_SECRET), NOT a per-salon
// Firebase token, so the CRM worker can seed on behalf of a not-yet-connected
// salon. The function caps ingestion at 5 reels.

// The europe-west1 copy runs beside Firestore (eur3). Not GLAURA_FUNCTIONS_BASE_URL:
// that one also serves createAgent / uploadServicesFromJSON, which have no EU
// function copy, so the seed gets its own override.
const DEFAULT_FUNCTIONS_BASE_URL = "https://europe-west1-beauty-984c8.cloudfunctions.net";

// seedOnboardingVideos downloads + uploads server-side, so give it room.
const SEED_TIMEOUT_MS = 540_000;

export type SeedReel = {
  videoUrl: string;
  caption: string;
  instagramVideoId: string;
  thumbnailUrl?: string | null;
  timestamp?: string | null;
};

export type SeedResult = {
  requested: number;
  synced: number;
  hashDupes: number;
  alreadySynced: number;
  undetectedFallback: number;
  failed: number;
};

type SeedResponse = { success?: boolean; data?: SeedResult; error?: string; code?: string };

/**
 * Seed up to 5 reels into `videos` for the given salon owner uid.
 * @throws when the secret is missing or the function returns a non-success.
 */
export async function seedOnboardingVideos(uid: string, reels: SeedReel[]): Promise<SeedResult> {
  const secret = process.env.ONBOARDING_SEED_SECRET;
  if (!secret) throw new Error("ONBOARDING_SEED_SECRET non défini.");
  if (reels.length === 0) {
    return { requested: 0, synced: 0, hashDupes: 0, alreadySynced: 0, undetectedFallback: 0, failed: 0 };
  }

  const base = process.env.ONBOARDING_SEED_FUNCTIONS_BASE_URL?.trim() || DEFAULT_FUNCTIONS_BASE_URL;
  const response = await fetch(`${base}/seedOnboardingVideos`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ uid, reels }),
    signal: AbortSignal.timeout(SEED_TIMEOUT_MS),
  });

  let body: SeedResponse;
  try {
    body = (await response.json()) as SeedResponse;
  } catch {
    throw new Error(`seedOnboardingVideos: réponse non-JSON (HTTP ${response.status})`);
  }

  if (!response.ok || !body.success || !body.data) {
    throw new Error(`seedOnboardingVideos: ${body.error ?? body.code ?? `HTTP ${response.status}`}`);
  }
  return body.data;
}
