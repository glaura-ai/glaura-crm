import { qualificationHash } from "./qualification";
import { prisma } from "@/lib/db";

export type StoredMessage = { id: string; participantId: string; username?: string; incoming: boolean; text: string; sentAt: Date };
export async function storeInstagramMessage(accountId: string, message: StoredMessage) {
  const id = `${accountId}:${message.participantId}`;
  await prisma.$transaction(async tx => {
    const conversation = await tx.instagramConversation.upsert({ where: { id }, create: { id, participantId: message.participantId, username: message.username, lastMessageAt: message.sentAt, lastInboundAt: message.incoming ? message.sentAt : null, qualificationPending: message.incoming && message.sentAt.getTime() > Date.now() - 30 * 86400000 }, update: { ...(message.username ? { username: message.username } : {}) } });
    await tx.instagramMessage.upsert({ where: { id: message.id }, create: { id: message.id, conversationId: id, incoming: message.incoming, text: message.text, sentAt: message.sentAt }, update: { text: message.text } });
    const newer = await tx.instagramConversation.updateMany({ where: { id, lastMessageAt: { lt: message.sentAt } }, data: { lastMessageAt: message.sentAt, ...(message.incoming ? { resolvedAt: null, waitingAt: null } : {}) } });
    void newer;
    if (message.incoming) await tx.instagramConversation.updateMany({ where: { id, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: message.sentAt } }] }, data: { lastInboundAt: message.sentAt, qualificationPending: message.sentAt.getTime() > Date.now() - 30 * 86400000, qualificationStartedAt: null, qualificationError: null, qualification: null, qualifiedMessageId: null, qualifiedMessageHash: null } });
    if (message.incoming && conversation.qualifiedMessageId === message.id && conversation.qualifiedMessageHash !== qualificationHash(message.text)) {
      await tx.instagramConversation.updateMany({ where: { id, qualifiedMessageId: message.id }, data: { qualificationPending: true, qualificationStartedAt: null, qualification: null, qualifiedMessageId: null, qualifiedMessageHash: null, qualificationError: null } });
    }
  });
}
