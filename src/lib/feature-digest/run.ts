import type { DigestRecipient } from "./recipients";

export type SendJob = DigestRecipient & { sample?: boolean };

export type RecordInput = {
  edition: string;
  providerId: string;
  email: string;
  sentAt?: Date;
  error?: string;
};

export type DigestDeps = {
  edition: string;
  recipients: readonly DigestRecipient[];
  /** Providers already sent for this edition (sentAt set). */
  sentProviderIds: ReadonlySet<string>;
  send: (job: SendJob) => Promise<void>;
  record: (entry: RecordInput) => Promise<void>;
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
  preview: DigestRecipient[];
};

const PREVIEW_SIZE = 20;
/** Sentinel id for --to samples: its unsubscribe token never touches a real salon. */
export const SAMPLE_PROVIDER_ID = "test-sample";

export async function runDigest(deps: DigestDeps, options: DigestMode): Promise<DigestResult> {
  const empty = { total: deps.recipients.length, sent: 0, skipped: 0, failed: 0, preview: [] };

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

  const pending = deps.recipients.filter((r) => !deps.sentProviderIds.has(r.providerId));
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += deps.batchSize) {
    if (i > 0) await deps.sleep(deps.delayMs);
    for (const r of pending.slice(i, i + deps.batchSize)) {
      try {
        await deps.send(r);
        await deps.record({ edition: deps.edition, providerId: r.providerId, email: r.email, sentAt: new Date() });
        sent += 1;
      } catch (err) {
        failed += 1;
        const error = err instanceof Error ? err.message : String(err);
        await deps.record({ edition: deps.edition, providerId: r.providerId, email: r.email, error });
      }
    }
  }
  return { ...empty, sent, failed, skipped: deps.recipients.length - pending.length };
}
