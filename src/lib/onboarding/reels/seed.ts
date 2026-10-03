// Push resolved reels into the salon's Glaura video feed. When
// GLAURA_MEDIA_BASE_URL is set this goes through the glaura-media Cloud Run
// service (async job: POST /v1/onboarding/seed, then poll /v1/jobs/{id});
// otherwise it falls back to the `seedOnboardingVideos` Cloud Function
// (goglow-firebase). Either way the backend owns
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

// glaura-media job polling: backoff 2s -> 5s -> 10s, ~30 min overall.
const POLL_DELAYS_MS = [2_000, 5_000, 10_000];
const POLL_TIMEOUT_MS = 30 * 60_000;
const MAX_TRANSIENT_POLL_ERRORS = 10; // ~1.5 min at 10 s: rides out a cold start or redeploy
const REQUEST_TIMEOUT_MS = 30_000;

export type SeedDeps = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

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

type JobResponse = {
  jobId?: string;
  status?: "queued" | "running" | "succeeded" | "failed";
  result?: SeedResult | null;
  code?: string | null;
};

type SeedResponse = { success?: boolean; data?: SeedResult; error?: string; code?: string };

/**
 * Seed up to 5 reels into `videos` for the given salon owner uid.
 * @throws when the secret is missing or the function returns a non-success.
 */
export async function seedOnboardingVideos(
  uid: string,
  reels: SeedReel[],
  deps: SeedDeps = {},
): Promise<SeedResult> {
  const secret = process.env.ONBOARDING_SEED_SECRET;
  if (!secret) throw new Error("ONBOARDING_SEED_SECRET non défini.");
  if (reels.length === 0) {
    return { requested: 0, synced: 0, hashDupes: 0, alreadySynced: 0, undetectedFallback: 0, failed: 0 };
  }

  const mediaBase = process.env.GLAURA_MEDIA_BASE_URL?.trim().replace(/\/+$/, "");
  if (mediaBase) return seedViaMedia(mediaBase, secret, uid, reels, deps);

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

async function readJson<T>(response: Response, label: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${label}: réponse non-JSON (HTTP ${response.status})`);
  }
}

async function seedViaMedia(
  base: string,
  secret: string,
  uid: string,
  reels: SeedReel[],
  deps: SeedDeps,
): Promise<SeedResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const headers = { authorization: `Bearer ${secret}` };

  const enqueue = await fetch(`${base}/v1/onboarding/seed`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ uid, reels }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const queued = await readJson<JobResponse & { error?: string; message?: string }>(
    enqueue,
    "seedOnboardingVideos",
  );
  if (enqueue.status !== 202 || !queued.jobId) {
    const detail = [queued.error, queued.message].filter(Boolean).join(": ") || undefined;
    throw new Error(`seedOnboardingVideos: ${detail ?? `HTTP ${enqueue.status}`}`);
  }

  const jobId = queued.jobId;
  const deadline = now() + POLL_TIMEOUT_MS;
  let transientErrors = 0;
  for (let attempt = 0; now() < deadline; attempt++) {
    await sleep(POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]);
    let job: JobResponse | null = null;
    try {
      const res = await fetch(`${base}/v1/jobs/${encodeURIComponent(jobId)}`, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 404) throw new Error(`seedOnboardingVideos: job ${jobId} introuvable (404)`);
      if (res.ok) job = await readJson<JobResponse>(res, "seedOnboardingVideos");
      else if (res.status < 500 && res.status !== 408 && res.status !== 429) throw new Error(`seedOnboardingVideos: HTTP ${res.status} (job ${jobId})`);
      else throw new TransientPollError(`HTTP ${res.status}`);
    } catch (err) {
      if (!(err instanceof TransientPollError) && err instanceof Error && err.message.startsWith("seedOnboardingVideos:")) {
        throw err;
      }
      if (++transientErrors > MAX_TRANSIENT_POLL_ERRORS) {
        throw new Error(`seedOnboardingVideos: échec du suivi du job ${jobId} (${(err as Error).message})`);
      }
      continue;
    }
    transientErrors = 0;
    if (job.status === "succeeded" && job.result) return job.result;
    if (job.status === "failed") throw new Error(`seedOnboardingVideos: ${job.code ?? "failed"}`);
    if (job.status !== "queued" && job.status !== "running") {
      throw new Error(`seedOnboardingVideos: statut inattendu ${String(job.status)} (job ${jobId})`);
    }
  }
  throw new Error(`seedOnboardingVideos: délai dépassé en attendant le job ${jobId}`);
}

class TransientPollError extends Error {}
