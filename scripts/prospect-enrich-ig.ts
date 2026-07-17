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
 * Env:
 *   - IG_COOKIES_PATH         — Netscape cookies.txt of a logged-in IG session
 *   - PROSPECT_IG_DELAY_MS    — base delay between IG calls (default 10000, ±30% jitter)
 *
 * The run stops cleanly on the first auth/rate-limit error (session dead,
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
  const { enrichProspectIg } = await import("../src/lib/prospection/enrich-ig");
  const { loadIgCookieHeader, IgAuthError, igDelayMs } = await import("../src/lib/prospection/instagram");
  const { sleep } = await import("../src/lib/prospection/http");

  const zone = argValue("zone");
  const parsedLimit = Number(argValue("limit"));
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(200, parsedLimit)) : 50;
  const cookieHeader = loadIgCookieHeader();

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
      const decision = await enrichProspectIg(prospect, cookieHeader, (m) => console.log(`[ig]${m}`));
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
      if (error instanceof IgAuthError) {
        console.error(`[ig] ARRÊT: ${error.message} (${prospects.length - index - 1} prospects non traités)`);
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
