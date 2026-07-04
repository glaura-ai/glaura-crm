/**
 * CLI harness for the Haiku-based salon-data extractor (Step P2).
 *
 * Usage: npx tsx scripts/onboard-extract-test.ts <path-to-saved-html> [sourceType]
 *
 * Reads a previously saved, fully-expanded HTML file (see
 * scripts/onboard-expand-test.ts), runs trimHtmlForExtraction(), and prints
 * the original/trimmed sizes plus a rough token estimate and a snippet of
 * the trimmed output.
 *
 * If ANTHROPIC_API_KEY is set in the process environment, it then runs the
 * live extractSalon() call and pretty-prints the parsed result plus a
 * summary. Otherwise it stops after the dry-run report — this script never
 * blocks or waits on a key.
 *
 * Note: this script does NOT load .env (no `dotenv/config` import) on
 * purpose, so a key sitting in .env for some other purpose can't trigger a
 * live (billed) call by surprise. To exercise the live path, either export
 * ANTHROPIC_API_KEY in your shell before running this script, or add
 * `import "dotenv/config";` here yourself once you're ready to wire it up.
 */

import { readFile } from "node:fs/promises";
import { extractSalon, trimHtmlForExtraction } from "../src/lib/onboarding/extract";
import type { SourceType } from "../src/lib/onboarding/expand";

const KNOWN_SOURCE_TYPES: readonly SourceType[] = ["planity", "treatwell", "acuity", "generic"];

function parseSourceType(value: string | undefined): SourceType {
  if (value && (KNOWN_SOURCE_TYPES as readonly string[]).includes(value)) {
    return value as SourceType;
  }
  return "planity";
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/onboard-extract-test.ts <path-to-saved-html> [sourceType]");
    process.exit(1);
  }
  const sourceType = parseSourceType(process.argv[3]);

  const html = await readFile(filePath, "utf8");

  console.log(`file: ${filePath}`);
  console.log(`sourceType: ${sourceType}`);
  console.log(`original size: ${html.length} chars`);

  const trimmed = trimHtmlForExtraction(html, sourceType);

  console.log(`trimmed size: ${trimmed.length} chars`);
  console.log(`rough token estimate: ~${estimateTokens(trimmed)} tokens`);
  console.log("--- trimmed output (first 1500 chars) ---");
  console.log(trimmed.slice(0, 1500));
  console.log("--- end snippet ---");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("DRY RUN — no ANTHROPIC_API_KEY, skipping live extraction.");
    return;
  }

  const result = await extractSalon(html, sourceType, filePath);

  console.log("--- extraction result ---");
  console.log(JSON.stringify(result, null, 2));
  console.log("--- summary ---");
  console.log(`services: ${result.services.length}`);
  console.log(`hours days present: ${Object.keys(result.salon.hours).length}`);
  console.log(`address: ${result.salon.address}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
