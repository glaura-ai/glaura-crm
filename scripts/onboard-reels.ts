/**
 * Seed a salon's Instagram reels into its Glaura video feed (cold onboarding),
 * or dry-run the acquisition without writing anything.
 *
 * Cookie-free pipeline:
 *   Graph Business Discovery (most-liked reels)
 *     → Playwright → saveinsta.to resolves each to an MP4 URL
 *       → seedOnboardingVideos Cloud Function (R2 + auto service-detection).
 *
 * Usage:
 *   # Live seed (needs Graph token + seed secret + a real salon uid):
 *   npm run onboard:reels -- --handle=@le.salon --uid=<firebaseUid> [--limit=5]
 *
 *   # Dry-run via Business Discovery (needs Graph token; no writes):
 *   npm run onboard:reels -- --handle=@le.salon --dry-run
 *
 *   # Dry-run WITHOUT a token — resolve + verify explicit reels (runs anywhere):
 *   npm run onboard:reels -- --permalinks=https://instagram.com/reel/AAA/,https://instagram.com/reel/BBB/ --dry-run
 *
 * Flags:
 *   --handle=<@salon|url>   Instagram handle (Business Discovery source)
 *   --uid=<firebaseUid>     Salon owner uid (required for a live seed)
 *   --permalinks=a,b        Explicit reel URLs; bypasses Business Discovery
 *   --limit=5               Max reels (1..5)
 *   --dry-run               Resolve only, never seed
 *   --verify                Download-check each resolved URL is a real MP4
 *                           (implied by --dry-run)
 *
 * Env:
 *   - IG_GRAPH_TOKEN / IG_GRAPH_USER_ID  — Graph Business Discovery (cookie-free)
 *   - ONBOARDING_SEED_SECRET             — shared secret for seedOnboardingVideos
 *   - GLAURA_FUNCTIONS_BASE_URL          — optional CF base (defaults to prod)
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function argValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg?.slice(flag.length + 3).trim() || undefined;
}

function printRows(rows: import("../src/lib/onboarding/reels").ReelRow[]) {
  for (const [i, r] of rows.entries()) {
    const status = r.videoUrl
      ? r.verify
        ? r.verify.ok
          ? `OK mp4 ${r.verify.totalBytes ? (r.verify.totalBytes / 1048576).toFixed(1) + "MB" : ""}`
          : `NON-MP4 (${r.verify.contentType ?? r.verify.error ?? "?"})`
        : `résolu (${r.method})`
      : `ÉCHEC (${r.error ?? "?"})`;
    const caption = r.caption ? ` · "${r.caption.replace(/\s+/g, " ").slice(0, 50)}"` : "";
    console.log(`  ${i + 1}. ${r.instagramVideoId} · ${r.likeCount} likes · ${status}${caption}`);
  }
}

async function main() {
  const { onboardSalonReels } = await import("../src/lib/onboarding/reels");

  const handle = argValue("handle");
  const uid = argValue("uid");
  const permalinksArg = argValue("permalinks");
  const permalinks = permalinksArg
    ? permalinksArg.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const dryRun = process.argv.includes("--dry-run");
  const verify = process.argv.includes("--verify") || dryRun;
  const parsedLimit = Number(argValue("limit"));
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 5;

  if (!handle && !permalinks) {
    console.error("Usage: npm run onboard:reels -- (--handle=<@salon>|--permalinks=<url,url>) [--uid=<uid>] [--dry-run] [--verify] [--limit=5]");
    process.exitCode = 1;
    return;
  }
  if (!dryRun && !uid) {
    console.error("[reels] --uid requis pour un seed réel (ou ajoute --dry-run).");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await onboardSalonReels(
      { handle, uid, permalinks, dryRun, verify, limit },
      (m) => console.log(`[reels] ${m}`),
    );
    console.log(`\n[reels] ${result.dryRun ? "DRY-RUN" : "SEED"} — ${result.handle}`);
    console.log(`[reels] ${result.resolved}/${result.candidates} reel(s) résolus`);
    printRows(result.rows);
    if (result.seed) console.log(`[reels] seed:`, JSON.stringify(result.seed));
    if (result.dryRun) console.log(`[reels] (aucune écriture — dry-run)`);
  } catch (error) {
    console.error(`[reels] échec: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

main();
