import { prisma } from "@/lib/db";
import { classifyLead, qualificationHash, type Qualification, type QualificationMessage } from "./qualification";

export const latestIncomingOrder = [{ sentAt: "desc" as const }, { id: "desc" as const }];
export async function latestIncoming(conversationId: string) {
  return prisma.instagramMessage.findFirst({ where: { conversationId, incoming: true }, orderBy: latestIncomingOrder });
}
export async function requireLatestIncoming(conversationId: string, messageId: unknown, expectedHash?: unknown) {
  const latest = await latestIncoming(conversationId);
  if (!latest || latest.id !== messageId || (expectedHash !== undefined && expectedHash !== qualificationHash(latest.text))) throw new Error("Un nouveau message est arrivé. Actualisez la conversation avant de continuer.");
  return latest;
}
export async function queueLeadQualification(id: string, messageId: unknown, expectedHash?: unknown) {
  await requireLatestIncoming(id, messageId, expectedHash);
  await prisma.instagramConversation.updateMany({ where: { id, qualificationPending: false }, data: { qualificationPending: true, qualificationStartedAt: null, qualificationError: null } });
}

export async function persistQualification(id: string, message: QualificationMessage, result: Qualification, source: "AI" | "MANUAL", lease?: Date) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "InstagramConversation" WHERE id = ${id} FOR UPDATE`;
    const latest = await tx.instagramMessage.findFirst({ where: { conversationId: id, incoming: true }, orderBy: latestIncomingOrder });
    if (!latest || latest.id !== message.id || qualificationHash(latest.text) !== qualificationHash(message.text)) return false;
    const saved = await tx.instagramConversation.updateMany({ where: { id, ...(lease ? { qualificationStartedAt: lease, qualificationPending: true } : {}) }, data: {
      qualification: result.temperature, qualificationReason: result.reason, qualificationAction: result.action,
      qualificationConfidence: result.confidence, qualificationSource: source,
      qualifiedMessageId: message.id, qualifiedMessageHash: qualificationHash(message.text), qualifiedAt: new Date(),
      qualificationPending: false, qualificationStartedAt: null, qualificationError: null,
    } });
    if (!saved.count) return false;
    const conversation = await tx.instagramConversation.findUniqueOrThrow({ where: { id }, select: { salonId: true } });
    // Only share the temperature, never the private rationale or message content.
    if (conversation.salonId) await tx.salon.updateMany({ where: { id: conversation.salonId, archivedAt: null,
      instagramConversations: { none: { id: { not: id }, lastInboundAt: { gt: message.sentAt } } },
    }, data: { leadTemperature: result.temperature } });
    return true;
  });
}

export async function processLeadQualification() {
  const stale = new Date(Date.now() - 2 * 60000);
  const available = { qualificationPending: true, OR: [{ qualificationStartedAt: null }, { qualificationStartedAt: { lt: stale } }] };
  const conversation = await prisma.instagramConversation.findFirst({ where: available, orderBy: { lastInboundAt: "desc" } });
  if (!conversation) return;
  const startedAt = new Date();
  const claimed = await prisma.instagramConversation.updateMany({ where: { id: conversation.id, ...available }, data: { qualificationStartedAt: startedAt } });
  if (!claimed.count) return;
  const lease = { id: conversation.id, qualificationPending: true, qualificationStartedAt: startedAt };
  try {
    const message = await latestIncoming(conversation.id);
    if (!message) throw new Error("No incoming message");
    const context = await prisma.instagramMessage.findMany({ where: { conversationId: conversation.id, sentAt: { lt: message.sentAt } }, orderBy: latestIncomingOrder, take: 6 });
    const result = await classifyLead(message, context.reverse());
    const saved = await persistQualification(conversation.id, message, result, "AI", startedAt);
    if (!saved) await prisma.instagramConversation.updateMany({ where: lease, data: { qualificationStartedAt: null } });
  } catch {
    await prisma.instagramConversation.updateMany({ where: lease, data: { qualificationPending: false, qualificationStartedAt: null, qualificationError: "La qualification automatique est indisponible. Réessayez ou choisissez une qualification manuelle." } });
  }
}

export function startLeadQualificationWorker() {
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try { await processLeadQualification(); }
    catch { console.error("Le service de qualification des leads est temporairement indisponible."); }
    finally { running = false; }
  };
  void poll();
  const timer = setInterval(() => { void poll(); }, 5000); timer.unref();
  return () => clearInterval(timer);
}
