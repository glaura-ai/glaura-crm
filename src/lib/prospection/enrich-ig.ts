import {
  candidateUsernames,
  decide,
  looksRelated,
  scoreCandidate,
  type IgDecision,
  type IgProfile,
  type IgProspectFacts,
  type ScoredCandidate,
} from "@/lib/prospection/ig-match";
import {
  fetchProfile,
  igDelayMs,
  IgSearchUnavailableError,
  searchAccounts,
} from "@/lib/prospection/instagram";
import { businessDiscovery, igGraphConfig, type IgGraphConfig } from "@/lib/prospection/ig-graph";
import { sleep } from "@/lib/prospection/http";
import type { CrawlLog } from "@/lib/prospection/crawl";

// Find + cross-validate the Instagram account of one salon.
//
// Two discovery backends, same cross-validation (ig-match.ts scoring):
//  - GRAPH (preferred, when IG_GRAPH_TOKEN is set): Business Discovery lookups
//    on guessed handles. Official, no personal cookies, runs from any IP.
//  - COOKIE (fallback): IG web search + web_profile_info with session cookies.
//
// Budget: jitter-paced, stops early once a candidate is definitive.

// Graph API calls are official + cheap, so we can probe more handle guesses;
// the cookie backend is rate-sensitive, so it stays conservative.
const MAX_GRAPH_LOOKUPS = 8;
const MAX_COOKIE_FETCHES = 4;

async function scoreViaGraph(
  prospect: IgProspectFacts,
  config: IgGraphConfig,
  log: CrawlLog,
): Promise<ScoredCandidate[]> {
  const scored: ScoredCandidate[] = [];
  for (const handle of candidateUsernames(prospect.name, prospect.city).slice(0, MAX_GRAPH_LOOKUPS)) {
    await sleep(igDelayMs());
    const profile = await businessDiscovery(handle, config);
    if (!profile) continue;
    const candidate = scoreCandidate(prospect, profile);
    log(`    @${candidate.username}: score ${candidate.score} [${candidate.signals.join(", ")}]`);
    scored.push(candidate);
    if (candidate.signals.includes("lien_resa")) break;
  }
  return scored;
}

async function discoverProfilesViaCookies(
  prospect: IgProspectFacts,
  cookieHeader: string,
  log: CrawlLog,
): Promise<IgProfile[]> {
  let usernames: string[];
  try {
    const hits = await searchAccounts(prospect.name, cookieHeader);
    const related = hits.filter((hit) => looksRelated(prospect.name, hit.username, hit.fullName));
    usernames = (related.length > 0 ? related : hits).map((hit) => hit.username);
  } catch (error) {
    if (!(error instanceof IgSearchUnavailableError)) throw error;
    log("    recherche IG indisponible → handles devinés");
    usernames = candidateUsernames(prospect.name, prospect.city);
  }

  const profiles: IgProfile[] = [];
  for (const username of usernames.slice(0, MAX_COOKIE_FETCHES)) {
    await sleep(igDelayMs());
    const profile = await fetchProfile(username, cookieHeader);
    if (profile) profiles.push(profile);
  }
  return profiles;
}

export async function enrichProspectIg(
  prospect: IgProspectFacts,
  auth: { graph: IgGraphConfig | null; cookieHeader: string | null },
  log: CrawlLog = () => {},
): Promise<IgDecision> {
  if (auth.graph) {
    return decide(await scoreViaGraph(prospect, auth.graph, log));
  }
  if (auth.cookieHeader) {
    const profiles = await discoverProfilesViaCookies(prospect, auth.cookieHeader, log);
    const scored = profiles.map((profile) => {
      const candidate = scoreCandidate(prospect, profile);
      log(`    @${candidate.username}: score ${candidate.score} [${candidate.signals.join(", ")}]`);
      return candidate;
    });
    return decide(scored);
  }
  throw new Error("Aucun backend Instagram configuré (IG_GRAPH_TOKEN ou IG_COOKIES_PATH).");
}

export { igGraphConfig };
