/**
 * Prospection sweep.
 *
 * Crawls public booking-directory listing pages (Treatwell, Planity, Booksy,
 * Fresha) for the configured zones (Paris arrondissements + petite couronne),
 * keeps salons with enough reviews (PROSPECT_MIN_REVIEWS, default 50), and
 * upserts them as `Prospect` rows. Salons already present in the CRM (matched
 * by booking URL or name+postal) are flagged DEJA_CRM and never enter tournées.
 *
 * Usage:
 *   npm run prospect:sweep -- --zone=paris-11            # one zone, all sources
 *   npm run prospect:sweep -- --source=treatwell         # one source, all zones
 *   npm run prospect:sweep -- --zone=paris-11 --source=planity
 *   npm run prospect:sweep                               # everything
 *
 * Env (loaded from .env via @next/env, same as the other workers):
 *   - DATABASE_URL             — Postgres (Prisma)
 *   - PROSPECT_MIN_REVIEWS     — review threshold (default 50)
 *   - PROSPECT_SWEEP_DELAY_MS  — delay between page fetches (default 1500)
 *   - PROSPECT_MAX_PAGES       — pagination cap per directory page (default 60)
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function argValues(flag: string): string[] {
  return process.argv
    .filter((arg) => arg.startsWith(`--${flag}=`))
    .flatMap((arg) => arg.slice(flag.length + 3).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

async function main() {
  // Env-dependent modules (Prisma reads DATABASE_URL at construction) are
  // imported dynamically so loadEnvConfig has already run.
  const { ZONES, ZONE_BY_SLUG } = await import("../src/lib/prospection/zones");
  const { ALL_SOURCES, buildTargets } = await import("../src/lib/prospection/sources");
  const { crawlTargets } = await import("../src/lib/prospection/crawl");
  const { upsertProspects } = await import("../src/lib/prospection/upsert");
  const { prisma } = await import("../src/lib/db");

  const zoneSlugs = argValues("zone");
  const zones = zoneSlugs.length
    ? zoneSlugs.map((slug) => {
        const zone = ZONE_BY_SLUG.get(slug);
        if (!zone) throw new Error(`Zone inconnue: ${slug} (voir src/lib/prospection/zones.ts)`);
        return zone;
      })
    : ZONES;

  const sourceNames = argValues("source").map((s) => s.toUpperCase());
  for (const name of sourceNames) {
    if (!(ALL_SOURCES as string[]).includes(name)) {
      throw new Error(`Source inconnue: ${name.toLowerCase()} (attendu: ${ALL_SOURCES.join(", ").toLowerCase()})`);
    }
  }
  const sources = sourceNames.length ? (sourceNames as typeof ALL_SOURCES) : ALL_SOURCES;

  const targets = buildTargets(sources, zones);
  console.log(
    `[sweep] ${targets.length} pages annuaire à parcourir (${sources.join(", ").toLowerCase()} × ${zones.length} zones)`,
  );

  const crawl = await crawlTargets(targets, (message) => console.log(`[sweep]${message}`));
  console.log(
    `[sweep] crawl terminé: ${crawl.pagesFetched} pages, ${crawl.prospects.length} salons uniques, ${crawl.errors.length} erreurs`,
  );

  const counts = await upsertProspects(crawl.prospects, (message) => console.log(`[sweep] ${message}`));
  console.log(
    `[sweep] upsert: ${counts.created} créés, ${counts.updated} mis à jour, ${counts.alreadyInCrm} déjà dans le CRM`,
  );
  if (crawl.errors.length) {
    console.warn(`[sweep] erreurs:\n - ${crawl.errors.join("\n - ")}`);
  }

  await prisma.$disconnect();
  if (crawl.errors.length && counts.kept === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[sweep] échec:", error);
  process.exitCode = 1;
});
