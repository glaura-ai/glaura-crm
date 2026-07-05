/**
 * CLI harness for the deterministic salon-page expander.
 *
 * Usage: npx tsx scripts/onboard-expand-test.ts <url>
 *
 * Runs expandSalonPage() against the given URL, writes the fully-expanded
 * HTML to the scratchpad directory, and prints the detected source type,
 * page title, and a count of service items found — both in the expanded
 * (headless-browser) HTML and in the raw static HTML (plain fetch, no
 * browser) — to show the static-vs-expanded delta.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { detectSource, expandSalonPage, type SourceType } from "../src/lib/onboarding/expand";

const SCRATCHPAD_DIR =
  "/private/tmp/claude-501/-Users-henryg-Documents-dev-glaura-glaura-crm/b799c89c-b6ee-4052-9ea9-e860a7d53b0c/scratchpad";

// Selector-equivalent patterns used to count "service name" nodes in raw HTML
// for each source type. Planity marks each service with a stable
// `id="service-name-*"` attribute; Treatwell uses a CSS-module class whose
// prefix is stable across salons even though the hash suffix is build-specific.
const SERVICE_NAME_PATTERNS: Partial<Record<SourceType, RegExp>> = {
  planity: /id="service-name-[^"]*"/g,
  treatwell: /class="[^"]*MenuItem-module--title[^"]*"/g,
};

function countServiceNodes(html: string, sourceType: SourceType): number {
  const pattern = SERVICE_NAME_PATTERNS[sourceType];
  if (!pattern || !html) return 0;
  return (html.match(pattern) ?? []).length;
}

async function fetchStaticHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GlauraOnboardingBot/1.0)" },
  });
  return res.text();
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx tsx scripts/onboard-expand-test.ts <url>");
    process.exit(1);
  }

  const sourceType = detectSource(url);
  console.log(`sourceType: ${sourceType}`);

  const [staticHtml, expanded] = await Promise.all([
    fetchStaticHtml(url).catch((err: unknown) => {
      console.error("static fetch failed:", err instanceof Error ? err.message : err);
      return "";
    }),
    expandSalonPage(url),
  ]);

  const outPath = path.join(SCRATCHPAD_DIR, `expanded-${expanded.sourceType}.html`);
  await writeFile(outPath, expanded.html, "utf8");

  const staticCount = countServiceNodes(staticHtml, sourceType);
  const expandedCount = countServiceNodes(expanded.html, expanded.sourceType);

  console.log(`title: ${expanded.title}`);
  console.log(`static service count: ${staticCount}`);
  console.log(`expanded service count: ${expandedCount}`);
  console.log(`expanded HTML written to: ${outPath}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
