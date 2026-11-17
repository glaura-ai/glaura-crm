import { describe, expect, it } from "vitest";
import { reelsStatus } from "./status";

const seed = { requested: 3, synced: 3, hashDupes: 0, alreadySynced: 0, undetectedFallback: 1, failed: 0 };

describe("reelsStatus", () => {
  it("is null before the reel step ran", () => {
    expect(reelsStatus(null)).toBeNull();
  });

  it("counts seeded videos and unresolved ones", () => {
    expect(reelsStatus({ type: "reels_done", text: null, data: { candidates: 4, resolved: 3, seed } })).toEqual({
      tone: "ok",
      text: "Vidéos : 3 ajoutées · 1 non récupérée",
    });
  });

  it("says when no video shows a service", () => {
    expect(reelsStatus({ type: "reels_done", text: null, data: { candidates: 0, resolved: 0, seed: null } })).toEqual({
      tone: "warn",
      text: "Vidéos : aucune vidéo Instagram ne montre un service",
    });
  });

  it("names a dead Instagram token", () => {
    const text = "Graph API: Error validating access token: The session has been invalidated (code 190)";
    expect(reelsStatus({ type: "reels_error", text, data: null })).toEqual({
      tone: "error",
      text: "Vidéos : échec — token Instagram invalide",
    });
  });

  it("passes other errors and skips through", () => {
    expect(reelsStatus({ type: "reels_error", text: "timeout", data: null })?.text).toBe("Vidéos : échec — timeout");
    expect(reelsStatus({ type: "reels_skipped", text: "pas de handle Instagram", data: null })).toEqual({
      tone: "warn",
      text: "Vidéos : non lancées — pas de handle Instagram",
    });
  });
});
