import { Timestamp } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import { inboxConfig } from "./client";
import { storeInstagramMessage, type StoredMessage } from "./store";

export function firebaseMessage(id: string, participantId: string, thread: Record<string, unknown>, data: Record<string, unknown>): StoredMessage | null {
  if (thread.channel && thread.channel !== "instagram") return null;
  if (data.channel && data.channel !== "instagram") return null;
  if (data.direction !== "inbound" && data.direction !== "outbound") return null;
  const raw = data.timestamp;
  const sentAt = raw instanceof Date ? raw : raw && typeof raw === "object" && "toDate" in raw && typeof raw.toDate === "function" ? raw.toDate() : null;
  if (!(sentAt instanceof Date) || !Number.isFinite(sentAt.getTime())) return null;
  const deleted = data.deletedOnInstagram === true || data.isDeleted === true || data.deleted === true || data.status === "deleted";
  return { id, participantId, username: typeof thread.participantUsername === "string" ? thread.participantUsername : undefined,
    incoming: data.direction === "inbound", sentAt,
    text: deleted ? "[Message supprimé]" : typeof data.text === "string" && data.text ? data.text : "[Pièce jointe — consulter Instagram]",
  };
}

export async function syncFirebaseInbox(since?: Date) {
  if (!process.env.CRM_INSTAGRAM_PROVIDER_ID) return { messages: 0 };
  const config = await inboxConfig();
  if (!config?.providerId) return { messages: 0 };
  const collection = getDb().collection("instagram_threads").doc(config.providerId).collection("threads");
  const query = since ? collection.where("updatedAt", ">=", Timestamp.fromDate(since)) : collection;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let count = 0;
  for (let page = 0; page < 10; page++) {
    const ordered = query.orderBy("updatedAt", "desc").limit(50);
    const threads = await (cursor ? ordered.startAfter(cursor) : ordered).get();
    for (const thread of threads.docs) {
      const metadata = thread.data();
      if (metadata.channel && metadata.channel !== "instagram") continue;
      const messages = await thread.ref.collection("messages").orderBy("timestamp", "desc").limit(100).get();
      for (const doc of messages.docs) {
        const message = firebaseMessage(doc.id, thread.id, metadata, doc.data());
        if (message) { await storeInstagramMessage(config.accountId, message); count++; }
      }
    }
    cursor = threads.docs.at(-1);
    if (threads.size < 50) break;
  }
  return { messages: count };
}

// Use the existing service process and webhook instead of registering a second
// Meta subscriber. One poll at a time, and failed polls retain the watermark.
export function startFirebaseInboxSync() {
  if (!process.env.CRM_INSTAGRAM_PROVIDER_ID) return () => {};
  let running = false;
  let since: Date | undefined;
  const poll = async () => {
    if (running) return;
    running = true;
    const startedAt = new Date(Date.now() - 5000);
    try { await syncFirebaseInbox(since); since = startedAt; }
    catch { console.error("Synchronisation de la messagerie Firebase temporairement indisponible."); }
    finally { running = false; }
  };
  void poll();
  const timer = setInterval(() => { void poll(); }, 30000);
  timer.unref();
  return () => clearInterval(timer);
}
