import type { DigestRecipient } from "./recipients";

export type SendJob = DigestRecipient & { sample?: boolean };

export type DigestDeps = {
  edition: string;
  recipients: readonly DigestRecipient[];
  send: (job: SendJob) => Promise<void>;
  /**
   * Atomically claims (edition, provider) before sending: true for a new row or a
   * previously failed one, false if sent, in flight elsewhere, or lost to a race.
   */
  claim: (recipient: DigestRecipient) => Promise<boolean>;
  /** Sets sentAt. Called in its own try after a successful send. */
  markSent: (recipient: DigestRecipient) => Promise<void>;
  /** Sets error, only on rows without sentAt. */
  markFailed: (recipient: DigestRecipient, error: string) => Promise<void>;
  /** Provider ids (among `providerIds`) whose featureAnnouncements.emailOptOut is now true. */
  optedOut: (providerIds: readonly string[]) => Promise<ReadonlySet<string>>;
  sleep: (ms: number) => Promise<void>;
  batchSize: number;
  delayMs: number;
};

export type DigestMode =
  | { mode: "dry-run" }
  | { mode: "test"; to: string }
  | { mode: "all" };

export type DigestResult = {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Sent, but marking sentAt failed (logged; the row stays claimed so it is never re-sent). */
  unrecorded: number;
  preview: DigestRecipient[];
};

const PREVIEW_SIZE = 20;
/** Sentinel id for --to samples: its unsubscribe token never touches a real salon. */
export const SAMPLE_PROVIDER_ID = "test-sample";

export async function runDigest(deps: DigestDeps, options: DigestMode): Promise<DigestResult> {
  const empty = { total: deps.recipients.length, sent: 0, skipped: 0, failed: 0, unrecorded: 0, preview: [] };

  if (options.mode === "dry-run") {
    return { ...empty, preview: deps.recipients.slice(0, PREVIEW_SIZE) };
  }

  if (options.mode === "test") {
    const first = deps.recipients[0];
    await deps.send({
      providerId: SAMPLE_PROVIDER_ID,
      email: options.to,
      salonName: first?.salonName ?? "",
      sample: true,
    });
    return { ...empty, sent: 1 };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let unrecorded = 0;
  for (let i = 0; i < deps.recipients.length; i += deps.batchSize) {
    if (i > 0) await deps.sleep(deps.delayMs);
    const batch = deps.recipients.slice(i, i + deps.batchSize);
    // Fresh per batch: a salon that unsubscribes mid-run is not mailed again.
    const optedOut = await deps.optedOut(batch.map((r) => r.providerId));
    for (const r of batch) {
      if (optedOut.has(r.providerId) || !(await deps.claim(r))) {
        skipped += 1;
        continue;
      }
      try {
        await deps.send(r);
      } catch (err) {
        failed += 1;
        await deps.markFailed(r, err instanceof Error ? err.message : String(err));
        continue;
      }
      sent += 1;
      try {
        await deps.markSent(r);
      } catch (err) {
        unrecorded += 1;
        console.error("[feature-digest] sent but sentAt not recorded", r.providerId, err);
      }
    }
  }
  return { ...empty, sent, skipped, failed, unrecorded };
}
