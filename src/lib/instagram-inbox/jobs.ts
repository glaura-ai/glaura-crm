import { prisma } from "@/lib/db";
import { syncInstagramHistory } from "./sync";
import { syncFirebaseInbox } from "./firebase-sync";
import type { SyncProgress } from "./progress";

export const INSTAGRAM_SYNC_ID = "glaura-inbox";
const staleMs = 5 * 60000;
const timeoutMs = 20 * 60000;
const interrupted = "La synchronisation a été interrompue. Les messages déjà enregistrés sont conservés. Vous pouvez la relancer.";

export async function requestInstagramSync() {
  await prisma.instagramSync.upsert({ where: { id: INSTAGRAM_SYNC_ID }, create: { id: INSTAGRAM_SYNC_ID, status: "IDLE" }, update: {} });
  // An atomic conditional write coalesces double clicks and concurrent requests.
  await prisma.instagramSync.updateMany({ where: { id: INSTAGRAM_SYNC_ID, status: { notIn: ["QUEUED", "PROCESSING"] } }, data: {
    status: "QUEUED", stage: null, requestedAt: new Date(), startedAt: null, finishedAt: null, heartbeatAt: null, error: null,
    metaConversations: 0, metaMessages: 0, firebaseThreads: 0, firebaseMessages: 0,
  } });
  return prisma.instagramSync.findUnique({ where: { id: INSTAGRAM_SYNC_ID } });
}

export async function processInstagramSync() {
  await prisma.instagramSync.updateMany({ where: { id: INSTAGRAM_SYNC_ID, status: "PROCESSING", heartbeatAt: { lt: new Date(Date.now() - staleMs) } }, data: { status: "FAILED", error: interrupted, finishedAt: new Date() } });
  const startedAt = new Date();
  const claimed = await prisma.instagramSync.updateMany({ where: { id: INSTAGRAM_SYNC_ID, status: "QUEUED" }, data: { status: "PROCESSING", startedAt, heartbeatAt: startedAt, stage: "META" } });
  if (!claimed.count) return;
  const lease = { id: INSTAGRAM_SYNC_ID, status: "PROCESSING", startedAt };
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void prisma.instagramSync.updateMany({ where: lease, data: { heartbeatAt: new Date() } })
      .then(result => { if (!result.count) controller.abort(); }).catch(() => controller.abort());
  }, 15000);
  const progress = async (p: SyncProgress) => {
    controller.signal.throwIfAborted();
    const result = await prisma.instagramSync.updateMany({ where: lease, data: { stage: p.stage, heartbeatAt: new Date(),
      ...(p.stage === "META" ? { metaConversations: p.conversations, metaMessages: p.messages } : { firebaseThreads: p.conversations, firebaseMessages: p.messages }),
    } });
    if (!result.count) throw new Error("Sync lease lost");
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Sync timeout")); }, timeoutMs); });
    const options = { signal: controller.signal, onProgress: progress };
    await Promise.race([(async () => { await syncInstagramHistory(undefined, options); await syncFirebaseInbox(undefined, options); })(), timeout]);
    controller.signal.throwIfAborted();
    await prisma.instagramSync.updateMany({ where: lease, data: { status: "DONE", finishedAt: new Date(), heartbeatAt: new Date() } });
  } catch {
    controller.abort();
    await prisma.instagramSync.updateMany({ where: lease, data: { status: "FAILED", error: interrupted, finishedAt: new Date() } });
  } finally { clearInterval(heartbeat); if (timer) clearTimeout(timer); }
}

export function startInstagramSyncWorker() {
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try { await processInstagramSync(); }
    catch { console.error("Le suivi de synchronisation Instagram est temporairement indisponible."); }
    finally { running = false; }
  };
  void poll();
  const timer = setInterval(() => { void poll(); }, 5000);
  timer.unref();
  return () => clearInterval(timer);
}
