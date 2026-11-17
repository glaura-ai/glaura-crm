// One line for the salon page's « Dernier job » card: what the reel step did,
// read from the job's last reels_* event. A silent 0 is how a dead Instagram
// token went unnoticed, so failures and skips say why.

export type ReelsEvent = { type: string | null; text: string | null; data: unknown };
export type ReelsStatus = { tone: "ok" | "warn" | "error"; text: string };

export const REELS_EVENT_TYPES = ["reels_done", "reels_error", "reels_skipped"] as const;

type DoneData = { candidates?: number; resolved?: number; seed?: { synced?: number } | null };

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

export function reelsStatus(event: ReelsEvent | null): ReelsStatus | null {
  if (!event) return null;
  const text = event.text?.trim() || "raison inconnue";

  if (event.type === "reels_error") {
    const reason = /code 190|access token/i.test(text) ? "token Instagram invalide" : text;
    return { tone: "error", text: `Vidéos : échec — ${reason}` };
  }
  if (event.type === "reels_skipped") return { tone: "warn", text: `Vidéos : non lancées — ${text}` };

  const data = (event.data ?? {}) as DoneData;
  const candidates = data.candidates ?? 0;
  if (candidates === 0) return { tone: "warn", text: "Vidéos : aucune vidéo Instagram ne montre un service" };

  const synced = data.seed?.synced ?? 0;
  const missed = candidates - (data.resolved ?? 0);
  return {
    tone: synced > 0 ? "ok" : "warn",
    text: `Vidéos : ${plural(synced, "ajoutée")}` + (missed > 0 ? ` · ${plural(missed, "non récupérée")}` : ""),
  };
}
