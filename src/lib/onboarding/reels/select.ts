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

const MatchSchema = z.object({ serviceReelIds: z.array(z.string()) });

const SYSTEM_PROMPT = [
  "Tu tries les reels Instagram d'un salon de beauté.",
  "Garde un reel seulement si sa légende montre clairement une prestation réalisée",
  "qui correspond à un des services du salon (résultat, avant/après, démonstration).",
  "Écarte vœux, annonces, promos sans prestation, lifestyle, concours, recrutement.",
  "Réponds avec les ids gardés.",
].join(" ");

/** Default classifier: one Haiku call for all captions. */
export const haikuReelClassifier: ReelClassifier = async (candidates, services) => {
  const client = new Anthropic({ timeout: 60_000 });
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(MatchSchema) },
    messages: [{
      role: "user",
      content: `Services du salon :\n${services.map((s) => `- ${s}`).join("\n")}\n\nReels :\n${JSON.stringify(candidates)}`,
    }],
  });
  const ids = new Set(candidates.map((c) => c.id));
  return new Set((response.parsed_output?.serviceReelIds ?? []).filter((id) => ids.has(id)));
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
