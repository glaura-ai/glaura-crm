import { prisma } from "@/lib/db";

export type StoredMessage = { id: string; participantId: string; username?: string; incoming: boolean; text: string; sentAt: Date };
export async function storeInstagramMessage(accountId: string, message: StoredMessage) {
  const id = `${accountId}:${message.participantId}`;
  await prisma.$transaction(async tx => {
    await tx.instagramConversation.upsert({ where: { id }, create: { id, participantId: message.participantId, username: message.username, lastMessageAt: message.sentAt, lastInboundAt: message.incoming ? message.sentAt : null }, update: { ...(message.username ? { username: message.username } : {}) } });
    await tx.instagramMessage.upsert({ where: { id: message.id }, create: { id: message.id, conversationId: id, incoming: message.incoming, text: message.text, sentAt: message.sentAt }, update: {} });
    const newer = await tx.instagramConversation.updateMany({ where: { id, lastMessageAt: { lt: message.sentAt } }, data: { lastMessageAt: message.sentAt, ...(message.incoming ? { resolvedAt: null } : {}) } });
    void newer;
    if (message.incoming) await tx.instagramConversation.updateMany({ where: { id, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: message.sentAt } }] }, data: { lastInboundAt: message.sentAt } });
  });
}
