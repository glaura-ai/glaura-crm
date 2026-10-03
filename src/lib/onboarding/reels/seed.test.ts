import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedOnboardingVideos, type SeedResult } from "./seed";

const RESULT: SeedResult = {
  requested: 2,
  synced: 2,
  hashDupes: 0,
  alreadySynced: 0,
  undetectedFallback: 0,
  failed: 0,
};
const REELS = [{ videoUrl: "https://x/v.mp4", caption: "c", instagramVideoId: "1" }];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("seedOnboardingVideos", () => {
  const fetchMock = vi.fn();
  const sleep = vi.fn(async (_ms: number) => {});

  beforeEach(() => {
    fetchMock.mockReset();
    sleep.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ONBOARDING_SEED_SECRET", "s3cret");
    vi.stubEnv("GLAURA_MEDIA_BASE_URL", "https://media.test/");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("enqueues then polls until succeeded (media path)", async () => {
    fetchMock
      .mockResolvedValueOnce(json(202, { jobId: "j1", status: "queued" }))
      .mockResolvedValueOnce(json(200, { jobId: "j1", status: "running" }))
      .mockResolvedValueOnce(json(200, { jobId: "j1", status: "succeeded", result: RESULT }));

    await expect(seedOnboardingVideos("uid1", REELS, { sleep })).resolves.toEqual(RESULT);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://media.test/v1/onboarding/seed");
    expect(init.headers.authorization).toBe("Bearer s3cret");
    expect(JSON.parse(init.body)).toEqual({ uid: "uid1", reels: REELS });
    expect(fetchMock.mock.calls[1][0]).toBe("https://media.test/v1/jobs/j1");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 5000]);
  });

  it("throws the job failure code", async () => {
    fetchMock
      .mockResolvedValueOnce(json(202, { jobId: "j1", status: "queued" }))
      .mockResolvedValueOnce(json(200, { jobId: "j1", status: "failed", code: "no_services" }));
    await expect(seedOnboardingVideos("uid1", REELS, { sleep })).rejects.toThrow(
      "seedOnboardingVideos: no_services",
    );
  });

  it("surfaces enqueue errors", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: "unauthorized" }));
    await expect(seedOnboardingVideos("uid1", REELS, { sleep })).rejects.toThrow(/unauthorized/);
  });

  it("times out with the jobId in the message", async () => {
    let t = 0;
    const now = () => t;
    const tick = vi.fn(async (ms: number) => {
      t += ms * 100;
    });
    fetchMock.mockResolvedValueOnce(json(202, { jobId: "jobTO", status: "queued" }));
    fetchMock.mockImplementation(async () => json(200, { jobId: "jobTO", status: "running" }));
    await expect(seedOnboardingVideos("uid1", REELS, { sleep: tick, now })).rejects.toThrow(/jobTO/);
  });

  it("tolerates transient poll errors", async () => {
    fetchMock
      .mockResolvedValueOnce(json(202, { jobId: "j1", status: "queued" }))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, { jobId: "j1", status: "succeeded", result: RESULT }));
    await expect(seedOnboardingVideos("uid1", REELS, { sleep })).resolves.toEqual(RESULT);
  });

  it("fails fast on poll 404", async () => {
    fetchMock
      .mockResolvedValueOnce(json(202, { jobId: "j1", status: "queued" }))
      .mockResolvedValueOnce(json(404, { error: "not_found" }));
    await expect(seedOnboardingVideos("uid1", REELS, { sleep })).rejects.toThrow(/404/);
  });

  it("falls back to the EU function when GLAURA_MEDIA_BASE_URL is unset", async () => {
    vi.stubEnv("GLAURA_MEDIA_BASE_URL", "");
    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: RESULT }));
    await expect(seedOnboardingVideos("uid1", REELS, { sleep })).resolves.toEqual(RESULT);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://europe-west1-beauty-984c8.cloudfunctions.net/seedOnboardingVideos",
    );
    expect(sleep).not.toHaveBeenCalled();
  });
});
