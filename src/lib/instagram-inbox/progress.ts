export type SyncProgress = { stage: "META" | "FIREBASE"; conversations: number; messages: number };
export type SyncOptions = { signal?: AbortSignal; onProgress?: (progress: SyncProgress) => Promise<void> };
export async function reportSyncProgress(options: SyncOptions, progress: SyncProgress) {
  options.signal?.throwIfAborted();
  await options.onProgress?.(progress);
}
