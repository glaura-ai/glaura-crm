import { inboxConfig, metaRequest, type InboxConfig } from "./client";
import { reportSyncProgress, type SyncOptions } from "./progress";
import { storeInstagramMessage } from "./store";

type MetaPage<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };
type MetaMessage = { id: string; message?: string; from?: { id: string; username?: string }; created_time: string };
export async function syncInstagramHistory(connection?: InboxConfig, options: SyncOptions = {}) {
  const config = connection ?? await inboxConfig();
  if (!config) throw new Error("La connexion de messagerie Instagram n’est pas configurée.");
  let conversationsRead = 0;
  let messagesRead = 0;
  let after: string | undefined;
  await reportSyncProgress(options, { stage: "META", conversations: 0, messages: 0 });
  // Bounded import, repeated safely through message-ID upserts. Webhooks maintain new messages.
  for (let page = 0; page < 5; page++) {
    options.signal?.throwIfAborted();
    const conversations: MetaPage<{ id: string; participants?: { data: { id: string; username?: string }[] } }> = await metaRequest(`${config.accountId}/conversations?platform=instagram&fields=id,participants&limit=20${after ? `&after=${encodeURIComponent(after)}` : ""}`, undefined, config);
    for (const conversation of conversations.data ?? []) {
      options.signal?.throwIfAborted();
      conversationsRead++;
      const participant = conversation.participants?.data.find(p => !config.ownerIds.includes(p.id) && (!config.username || p.username?.toLowerCase() !== config.username));
      if (!participant) continue;
      let messageAfter: string | undefined;
      for (let mPage = 0; mPage < 5; mPage++) {
        options.signal?.throwIfAborted();
        const messages: MetaPage<MetaMessage> = await metaRequest(`${encodeURIComponent(conversation.id)}/messages?fields=id,message,from,created_time&limit=20${messageAfter ? `&after=${encodeURIComponent(messageAfter)}` : ""}`, undefined, config);
        for (const m of messages.data ?? []) {
          options.signal?.throwIfAborted();
          const sentAt = new Date(m.created_time);
          if (!m.from?.id || !Number.isFinite(sentAt.getTime())) continue;
          messagesRead++;
          await storeInstagramMessage(config.accountId, { id: m.id, participantId: participant.id, username: participant.username, incoming: !config.ownerIds.includes(m.from.id) && (!config.username || m.from.username?.toLowerCase() !== config.username), text: m.message || "[Pièce jointe — consulter Instagram]", sentAt });
        }
        await reportSyncProgress(options, { stage: "META", conversations: conversationsRead, messages: messagesRead });
        messageAfter = messages.paging?.next ? messages.paging.cursors?.after : undefined;
        if (!messageAfter) break;
      }
    }
    after = conversations.paging?.next ? conversations.paging.cursors?.after : undefined;
    if (!after) break;
  }

  return { conversations: conversationsRead, messages: messagesRead };
}
