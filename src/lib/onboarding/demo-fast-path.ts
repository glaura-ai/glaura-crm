import { sampleServiceNames } from "./pro-progress";
import type { ExpandOptions } from "./expand";
import type { ExtractSalonOptions } from "./extract";

/** Identity channel of the glaura.ai/laura lead magnet: a visitor waits on screen for the build. */
export const LAURA_DEMO_CHANNEL = "laura_demo";

/** The demo lane looks for a new job this often, instead of the 60s default of the main loop. */
export const LAURA_DEMO_POLL_MS = 2_000;

/** Max demo jobs the dedicated lane builds at once (each launches its own browser). */
export const LAURA_DEMO_LANE_BATCH = 3;

/** Services per parallel LLM call: ~20 keeps each call near 10s on Haiku. */
export const LAURA_DEMO_EXTRACT_CHUNK_SIZE = 20;

/** Prisma filter for QUEUED demo jobs (the channel lives in the job's JSON config). */
export const LAURA_DEMO_JOB_WHERE = {
  status: "QUEUED" as const,
  config: { path: ["identityChannel"], equals: LAURA_DEMO_CHANNEL },
};

export function isLauraDemoJob(overrides: { identityChannel?: string | null } | null | undefined): boolean {
  return overrides?.identityChannel === LAURA_DEMO_CHANNEL;
}

/** Pipeline options for a job: latency-first for the Laura demo, untouched otherwise. */
export function buildOptions(overrides: { identityChannel?: string | null } | null | undefined): {
  expand: ExpandOptions | undefined;
  extract: ExtractSalonOptions | undefined;
} {
  if (!isLauraDemoJob(overrides)) return { expand: undefined, extract: undefined };
  return { expand: { fast: true }, extract: { chunkSize: LAURA_DEMO_EXTRACT_CHUNK_SIZE } };
}

type PagePreview = { name: string; serviceCount: number; serviceNames: string[] };

/**
 * `expand_done` event data. For the demo it also carries the deterministic
 * first look (name, counts, sample services) so the waiting visitor sees real
 * numbers seconds before the LLM extraction finishes.
 */
export function expandDoneData(
  expanded: { sourceType: string; title: string; html: string },
  preview: PagePreview | null,
) {
  const base = { sourceType: expanded.sourceType, title: expanded.title, htmlBytes: expanded.html.length };
  if (!preview) return base;
  return {
    ...base,
    name: preview.name || null,
    serviceCount: preview.serviceCount,
    sampleServices: sampleServiceNames(preview.serviceNames),
  };
}
