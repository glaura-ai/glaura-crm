import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Reel } from "./ig-reels";

// Picks which reels are worth seeding: the newest ones whose caption shows one
// of the salon's services. Lifestyle/promo/greeting reels are dropped instead
// of padding the feed — the Cloud Function would hold them out anyway.

const MODEL = "claude-haiku-4-5";
const CAPTION_CHARS = 400;

export type CaptionCandidate = { id: string; caption: string };
export type ReelClassifier = (candidates: CaptionCandidate[], services: string[]) => Promise<Set<string>>;

// Each kept reel must name the service it shows (by its number in the list):
// "sounds beauty-related" is not enough. Mirrors the publishable rule of the
// backend matcher (goglow-firebase instagram/serviceMatcherLLM.js), which
// otherwise hides the reel after upload and wastes one of the 5 slots.
const MatchSchema = z.object({
  matches: z.array(z.object({ reelId: z.string(), serviceNumber: z.number() })),
});

const SYSTEM_PROMPT = [
  "Tu tries les reels Instagram d'un salon de beauté.",
  "Pour chaque reel, trouve le service de la liste numérotée que la vidéo montre réellement :",
  "le résultat, la technique ou l'avant/après d'une prestation précise et réservable.",
  "Garde un reel SEULEMENT si la légende nomme ou décrit clairement cette prestation",
  "et que le reel aurait sa place sur la page de ce service.",
  "Écarte : légendes vagues ou d'ambiance (« transformation », « élégance ») sans prestation nommée,",
  "présentation d'outils, de matériel ou de produits, vœux, annonces, promos, ouverture d'agenda,",
  "lifestyle, conseils généraux, concours, recrutement, et toute prestation absente de la liste.",
  "Dans le doute, écarte. Réponds avec les reels gardés et le numéro du service.",
].join(" ");

/** Default classifier: one Haiku call for all captions. */
export const haikuReelClassifier: ReelClassifier = async (candidates, services) => {
  const client = new Anthropic({ timeout: 60_000 });
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(MatchSchema) },
    messages: [{
      role: "user",
      content: `Services du salon :\n${services.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nReels :\n${JSON.stringify(candidates)}`,
    }],
  });
  const ids = new Set(candidates.map((c) => c.id));
  const validService = (n: number) => Number.isInteger(n) && n >= 1 && n <= services.length;
  return new Set(
    (response.parsed_output?.matches ?? [])
      .filter((m) => ids.has(m.reelId) && validService(m.serviceNumber))
      .map((m) => m.reelId),
  );
};

const newestFirst = (a: Reel, b: Reel) => (b.timestamp ?? "").localeCompare(a.timestamp ?? "");

/**
 * The `limit` newest reels whose caption matches a salon service. With no
 * service list to judge against (e.g. a dry-run without an account), falls
 * back to the newest reels.
 */
export async function selectServiceReels(
  reels: readonly Reel[],
  services: readonly string[],
  limit: number,
  classify: ReelClassifier = haikuReelClassifier,
): Promise<Reel[]> {
  const sorted = [...reels].sort(newestFirst);
  const serviceNames = services.map((s) => s.trim()).filter(Boolean);
  if (serviceNames.length === 0) return sorted.slice(0, limit);

  const candidates = sorted
    .filter((r) => r.caption.trim())
    .map((r) => ({ id: r.instagramVideoId, caption: r.caption.trim().slice(0, CAPTION_CHARS) }));
  if (candidates.length === 0) return [];

  const keep = await classify(candidates, serviceNames);
  return sorted.filter((r) => keep.has(r.instagramVideoId)).slice(0, limit);
}
