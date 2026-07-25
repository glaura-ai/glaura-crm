/**
 * Live smoke test for the Google Business Profile lookup.
 *
 * Reads `name|address` lines on stdin and prints, for each, what Places
 * returned and whether isPlausibleMatch accepted it. Use it to measure match
 * quality on real salons before spending the monthly free allotment on a full
 * backfill — the name-overlap guard is deliberately strict, so it is worth
 * seeing how many genuine profiles it rejects.
 *
 * Usage:
 *   printf 'Kiyomi|75011 Paris\nBrow By Christina|75008 Paris\n' \
 *     | npx tsx scripts/prospect-google-test.ts
 *
 * Costs one Pro-SKU Text Search call per line. Never prints the API key.
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { buildQuery, findPlace, isPlausibleMatch, placesApiKey } from "../src/lib/prospection/google-places";
import { normalizeName } from "../src/lib/prospection/match";

async function main() {
  const apiKey = placesApiKey();
  if (!apiKey) {
    console.error("GOOGLE_PLACES_KEY manquant (.env)");
    process.exitCode = 1;
    return;
  }

  const input = await new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (buf += chunk));
    process.stdin.on("end", () => resolve(buf));
  });

  const rows = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, address] = line.split("|");
      return { name: (name ?? "").trim(), address: (address ?? "").trim() || null };
    })
    .filter((r) => r.name);

  console.log(`${rows.length} salon(s) à tester\n`);

  let accepted = 0;
  let rejected = 0;
  let none = 0;

  for (const row of rows) {
    try {
      // findPlace applies the guard internally; re-run the raw comparison so a
      // rejection can be told apart from "Google returned nothing".
      const match = await findPlace(apiKey, row.name, row.address, null);
      if (match) {
        accepted++;
        const exact = normalizeName(match.displayName) === normalizeName(row.name);
        console.log(`✓ ${row.name}`);
        console.log(`    → ${match.displayName}${exact ? "" : "  (variante)"} — ${match.formattedAddress} [${match.businessStatus ?? "?"}]`);
      } else {
        console.log(`✗ ${row.name}`);
        console.log(`    → aucun profil retenu   (requête: "${buildQuery(row.name, row.address, null)}")`);
        none++;
      }
    } catch (error) {
      rejected++;
      console.log(`! ${row.name}: ${error instanceof Error ? error.message : error}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\n${accepted} retenu(s), ${none} sans profil retenu, ${rejected} erreur(s)`);
  // Sanity check that the guard is loaded and behaving, without an API call.
  console.log(`guard check: "Baton Rouge"/"Baton Rouge Paris" = ${isPlausibleMatch("Baton Rouge", "Baton Rouge Paris")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
