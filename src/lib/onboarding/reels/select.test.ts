import { describe, expect, it, vi } from "vitest";
import type { Reel } from "./ig-reels";
import { selectServiceReels } from "./select";

const reel = (id: string, caption: string, timestamp: string): Reel => ({
  instagramVideoId: id,
  caption,
  permalink: `https://www.instagram.com/reel/${id}/`,
  thumbnailUrl: null,
  mediaUrl: null,
  timestamp,
  likeCount: 0,
});

const REELS = [
  reel("old", "Pose gel #nails", "2026-01-01T10:00:00+0000"),
  reel("new", "Semi-permanent mains ✨", "2026-11-01T10:00:00+0000"),
  reel("mid", "Bonne année à toutes !", "2026-06-01T10:00:00+0000"),
  reel("empty", "", "2026-11-10T10:00:00+0000"),
];
const SERVICES = ["Pose gel mains", "Vernis semi-permanent"];

describe("selectServiceReels", () => {
  it("keeps only service reels, newest first, capped", async () => {
    const classify = vi.fn(async () => new Set(["old", "new"]));
    const picked = await selectServiceReels(REELS, SERVICES, 5, classify);
    expect(picked.map((r) => r.instagramVideoId)).toEqual(["new", "old"]);
    expect(await selectServiceReels(REELS, SERVICES, 1, classify)).toHaveLength(1);
  });

  it("never sends caption-less reels to the classifier", async () => {
    const classify = vi.fn(async () => new Set<string>());
    await selectServiceReels(REELS, SERVICES, 5, classify);
    const sent = (classify.mock.calls[0] as unknown[])[0] as { id: string }[];
    expect(sent.map((c) => c.id)).not.toContain("empty");
  });

  it("returns nothing when no reel matches a service", async () => {
    await expect(selectServiceReels(REELS, SERVICES, 5, async () => new Set())).resolves.toEqual([]);
  });

  it("falls back to the newest reels when the salon has no services", async () => {
    const classify = vi.fn();
    const picked = await selectServiceReels(REELS, [], 2, classify);
    expect(picked.map((r) => r.instagramVideoId)).toEqual(["empty", "new"]);
    expect(classify).not.toHaveBeenCalled();
  });
});
