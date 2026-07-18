/**
 * Enrichissement Instagram des prospects (cross-validation).
 *
 * For each prospect awaiting enrichment (igStatus A_FAIRE/ERREUR, prospect
 * NOUVEAU or EN_TOURNEE), searches Instagram by salon name and cross-validates
 * candidate accounts against the salon (booking link in bio = definitive,
 * name + location + beauty category otherwise). Auto-confirms only on strong
 * signals; ambiguous matches land in igCandidates for one-click validation
 * on /prospection.
 *
 * Usage:
 *   npm run prospect:ig -- --zone=paris-11 --limit=25
 *
 * Backend (auto-selected):
 *   - GRAPH (preferred): set IG_GRAPH_TOKEN + IG_GRAPH_USER_ID → Business
 *     Discovery. Official, no personal cookies, runs from the VPS.
 *   - COOKIE (fallback): set IG_COOKIES_PATH (Netscape cookies.txt).
 *
 * Env:
 *   - IG_GRAPH_TOKEN / IG_GRAPH_USER_ID — Graph API Page token + our IG business id
 *   - IG_COOKIES_PATH                   — Netscape cookies.txt of a logged-in session
 *   - PROSPECT_IG_DELAY_MS              — base delay between IG calls (default 10000, ±30% jitter)
 *
 * The run stops cleanly on the first auth/rate-limit error (token expired,
 * 429, checkpoint) — remaining prospects stay A_FAIRE and are picked up on
 * the next run.
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function argValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg?.slice(flag.length + 3).trim() || undefined;
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { enrichProspectIg, igGraphConfig } = await import("../src/lib/prospection/enrich-ig");
  const { loadIgCookieHeader, IgAuthError, igDelayMs } = await import("../src/lib/prospection/instagram");
  const { IgGraphAuthError, IgGraphRateLimitError } = await import("../src/lib/prospection/ig-graph");
  const { sleep } = await import("../src/lib/prospection/http");

  const zone = argValue("zone");
  const parsedLimit = Number(argValue("limit"));
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(500, parsedLimit)) : 50;

  // Prefer the official Graph API backend; fall back to session cookies.
  const graph = igGraphConfig();
  const cookieHeader = graph ? null : loadIgCookieHeader();
  const auth = { graph, cookieHeader };
  console.log(`[ig] backend: ${graph ? "Graph API (business_discovery)" : "cookies"}`);

  const isFatal = (error: unknown) =>
    error instanceof IgAuthError || error instanceof IgGraphAuthError || error instanceof IgGraphRateLimitError;

  const prospects = await prisma.prospect.findMany({
    where: {
      igStatus: { in: ["A_FAIRE", "ERREUR"] },
      status: { in: ["NOUVEAU", "EN_TOURNEE"] },
      ...(zone ? { zone } : {}),
    },
    // Today's tournées first, then the most reviewed.
    orderBy: [{ status: "desc" }, { reviewCount: "desc" }],
    take: limit,
    select: { id: true, name: true, sourceUrl: true, postalCode: true, city: true, instagram: true },
  });
  console.log(`[ig] ${prospects.length} prospects à enrichir${zone ? ` (zone ${zone})` : ""}`);

  let confirmed = 0;
  let toValidate = 0;
  let notFound = 0;

  for (const [index, prospect] of prospects.entries()) {
    console.log(`[ig] ${index + 1}/${prospects.length} ${prospect.name}`);
    try {
      const decision = await enrichProspectIg(prospect, auth, (m) => console.log(`[ig]${m}`));
      const now = new Date();
      // Never overwrite a manually set handle: if the confirmed account is a
      // DIFFERENT one, downgrade to A_VALIDER instead of mixing their data.
      const conflictsWithManual =
        decision.status === "CONFIRME" && prospect.instagram != null && prospect.instagram !== decision.best.username;
      if (decision.status === "CONFIRME" && !conflictsWithManual) {
        confirmed++;
        await prisma.prospect.update({
          where: { id: prospect.id },
          data: {
            instagram: decision.best.username,
            instagramFollowers: decision.best.followers,
            igCandidates: decision.candidates,
            igStatus: "CONFIRME",
            igCheckedAt: now,
          },
        });
        console.log(`[ig]   → CONFIRMÉ @${decision.best.username} (${decision.best.followers ?? "?"} followers)`);
      } else if (decision.status === "A_VALIDER" || conflictsWithManual) {
        toValidate++;
        await prisma.prospect.update({
          where: { id: prospect.id },
          data: { igCandidates: decision.candidates, igStatus: "A_VALIDER", igCheckedAt: now },
        });
        console.log(`[ig]   → à valider (${decision.candidates.length} candidat(s))`);
      } else {
        notFound++;
        await prisma.prospect.update({
          where: { id: prospect.id },
          data: { igStatus: "INTROUVABLE", igCheckedAt: now },
        });
        console.log("[ig]   → introuvable");
      }
    } catch (error) {
      if (isFatal(error)) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ig] ARRÊT: ${message} (${prospects.length - index - 1} prospects non traités)`);
        process.exitCode = 1;
        break;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ig]   → erreur: ${message}`);
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: { igStatus: "ERREUR", igCheckedAt: new Date() },
      });
    }
    await sleep(igDelayMs());
  }

  console.log(`[ig] terminé: ${confirmed} confirmés, ${toValidate} à valider, ${notFound} introuvables`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[ig] échec:", error);
  process.exitCode = 1;
});
