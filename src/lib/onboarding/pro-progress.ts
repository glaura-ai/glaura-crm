import { proPreviewToken } from "@/lib/onboarding/pro-preview";

export type ProProgressStage = "queued" | "reading" | "learning" | "preparing" | "ready" | "failed";

export type ProProgress = {
  stage: ProProgressStage;
  sourceType: string | null;
  salonName: string | null;
  serviceCount: number | null;
  staffCount: number | null;
  sampleServices: string[];
  previewToken: string | null;
};

export type ProgressEvent = { type: string | null; data: unknown };

const MAX_SAMPLE = 5;
const MAX_SAMPLE_LENGTH = 60;

/** First service names for the live progress UI: trimmed strings only, bounded. */
export function sampleServiceNames(names: readonly unknown[]): string[] {
  return names
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim().slice(0, MAX_SAMPLE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_SAMPLE);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Derives the public progress of a pro-preview job from all its events.
 * `review_required` is a failure for this UI: the owner is told we will text.
 */
export function deriveProProgress(
  job: { id: string; status: string },
  events: readonly ProgressEvent[],
  previewSecret: string,
): ProProgress {
  const seen = new Set(events.map((event) => event.type).filter((type): type is string => Boolean(type)));
  const dataOf = (type: string) => record(events.find((event) => event.type === type)?.data);
  const extract = dataOf("extract_done");
  const expand = dataOf("expand_done");

  const failed = job.status === "FAILED" || job.status === "REVIEW_REQUIRED" ||
    seen.has("failed") || seen.has("job_error") || seen.has("review_required");
  const ready = seen.has("preview_ready");

  let stage: ProProgressStage;
  if (failed) stage = "failed";
  else if (ready) stage = "ready";
  else if (seen.has("extract_done")) stage = "preparing";
  else if (seen.has("expand_done")) stage = "learning";
  else if (seen.has("job_started")) stage = "reading";
  else stage = "queued";

  const rawSample = Array.isArray(extract.sampleServices) ? extract.sampleServices : [];
  return {
    stage,
    sourceType: typeof expand.sourceType === "string" ? expand.sourceType : null,
    salonName: typeof extract.name === "string" ? extract.name : null,
    serviceCount: count(extract.serviceCount),
    staffCount: count(extract.staffCount),
    sampleServices: sampleServiceNames(rawSample),
    previewToken: stage === "ready" ? proPreviewToken(job.id, previewSecret) : null,
  };
}
