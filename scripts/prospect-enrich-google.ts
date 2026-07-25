/**
 * Google Business Profile lookup for prospects.
 *
 * For each prospect not yet checked, searches Places Text Search by name +
 * address and records whether a plausible profile exists. Presence is a ranking
 * signal — a salon findable on Google is a real business — and never excludes
 * anyone from the pool or from tournées.
 *
 * Usage:
 *   npm run prospect:google -- --zone=paris-11 --limit=200
 *   npm run prospect:google -- --retry          # also re-check INTROUVABLE/ERREUR
 *
 * Env:
 *   - GOOGLE_PLACES_KEY         — Places API (New) key, Text Search enabled
 *   - PROSPECT_GOOGLE_DELAY_MS  — delay between calls (default 200)
 *   - PROSPECT_GOOGLE_MAX       — hard ceiling on calls per run (default 1000)
 *
 * COST: the Pro field mask gives 5 000 free lookups/month, then $32/1k. The
 * whole pool (~3 300) fits in one month's free allotment, and googleCheckedAt
 * means a prospect is never looked up twice. --retry deliberately re-spends.
 * Do not add rating/userRatingCount to the field mask — see google-places.ts.
 *
 * The run stops cleanly on the first auth/quota error; unprocessed prospects
 * keep their status and are picked up next run.
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function argValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg?.slice(flag.length + 3).trim() || undefined;
}

function numFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { findPlace, placesApiKey, PlacesAuthError, PlacesQuotaError } = await import(
    "../src/lib/prospection/google-places"
  );
  const { sleep } = await import("../src/lib/prospection/http");

  const apiKey = placesApiKey();
  if (!apiKey) {
    console.error("[google] GOOGLE_PLACES_KEY manquant — rien à faire.");
    process.exitCode = 1;
    return;
  }

  const zone = argValue("zone");
  const retry = process.argv.includes("--retry");
  const parsedLimit = Number(argValue("limit"));
  const maxPerRun = numFromEnv("PROSPECT_GOOGLE_MAX", 1000);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(maxPerRun, parsedLimit))
    : Math.min(200, maxPerRun);
  const delayMs = numFromEnv("PROSPECT_GOOGLE_DELAY_MS", 200);

  const statuses = retry
    ? (["A_FAIRE", "ERREUR", "INTROUVABLE"] as const)
    : (["A_FAIRE", "ERREUR"] as const);

  const prospects = await prisma.prospect.findMany({
    where: {
      googleStatus: { in: [...statuses] },
      status: { in: ["NOUVEAU", "EN_TOURNEE"] },
      ...(zone ? { zone } : {}),
    },
    // Best tiers first: if the budget runs out, it runs out on prospects nobody
    // was going to call.
    orderBy: [{ tier: "desc" }, { reviewCount: "desc" }],
    take: limit,
    select: { id: true, name: true, address: true, city: true, postalCode: true },
  });

  console.log(`[google] ${prospects.length} prospect(s) à vérifier${zone ? ` (zone ${zone})` : ""}`);

  let found = 0;
  let missing = 0;
  let failed = 0;

  for (const prospect of prospects) {
    const now = new Date();
    try {
      const locality = [prospect.postalCode, prospect.city].filter(Boolean).join(" ") || null;
      const match = await findPlace(apiKey, prospect.name, prospect.address, locality);

      await prisma.prospect.update({
        where: { id: prospect.id },
        data: match
          ? {
              googlePlaceId: match.placeId,
              googleName: match.displayName,
              googleStatus: "TROUVE",
              googleCheckedAt: now,
            }
          : { googleStatus: "INTROUVABLE", googleCheckedAt: now },
      });

      if (match) {
        found++;
        console.log(`[google]   ✓ ${prospect.name} → ${match.displayName}`);
      } else {
        missing++;
        console.log(`[google]   – ${prospect.name} : aucun profil`);
      }
    } catch (error) {
      if (error instanceof PlacesAuthError || error instanceof PlacesQuotaError) {
        console.error(`[google] arrêt: ${error.message}`);
        break;
      }
      failed++;
      console.error(`[google]   ! ${prospect.name}: ${error instanceof Error ? error.message : error}`);
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: { googleStatus: "ERREUR", googleCheckedAt: now },
      });
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  console.log(`[google] terminé — ${found} trouvé(s), ${missing} sans profil, ${failed} erreur(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  });
