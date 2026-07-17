import {
  candidateUsernames,
  decide,
  looksRelated,
  scoreCandidate,
  type IgDecision,
  type IgProspectFacts,
} from "@/lib/prospection/ig-match";
import {
  fetchProfile,
  igDelayMs,
  IgSearchUnavailableError,
  searchAccounts,
} from "@/lib/prospection/instagram";
import { sleep } from "@/lib/prospection/http";
import type { CrawlLog } from "@/lib/prospection/crawl";

// Find + cross-validate the Instagram account of one salon.
// Discovery: IG search when the session allows it, otherwise guessed handles
// derived from the salon name (probed via web_profile_info, 404 = miss).
// Validation: pure scoring in ig-match.ts — only confirmed on strong signals.
// Budget: jitter-paced, stops early once a candidate is definitive.

const MAX_PROFILE_FETCHES = 4;

async function discoverUsernames(
  prospect: IgProspectFacts,
  cookieHeader: string,
  log: CrawlLog,
): Promise<string[]> {
  try {
    const hits = await searchAccounts(prospect.name, cookieHeader);
    const related = hits.filter((hit) => looksRelated(prospect.name, hit.username, hit.fullName));
    if (related.length > 0) return related.map((hit) => hit.username);
    return hits.map((hit) => hit.username);
  } catch (error) {
    if (!(error instanceof IgSearchUnavailableError)) throw error;
    log("    recherche IG indisponible → handles devinés");
    return candidateUsernames(prospect.name, prospect.city);
  }
}

export async function enrichProspectIg(
  prospect: IgProspectFacts,
  cookieHeader: string,
  log: CrawlLog = () => {},
): Promise<IgDecision> {
  const usernames = await discoverUsernames(prospect, cookieHeader, log);

  const scored = [];
  for (const username of usernames.slice(0, MAX_PROFILE_FETCHES)) {
    await sleep(igDelayMs());
    const profile = await fetchProfile(username, cookieHeader);
    if (!profile) continue;
    const candidate = scoreCandidate(prospect, profile);
    log(`    @${candidate.username}: score ${candidate.score} [${candidate.signals.join(", ")}]`);
    scored.push(candidate);
    // Booking link in bio is definitive — no need to burn more requests.
    if (candidate.signals.includes("lien_resa")) break;
  }

  return decide(scored);
}
