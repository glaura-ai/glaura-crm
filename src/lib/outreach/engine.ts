import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { inboxConfig, metaRequest } from "@/lib/instagram-inbox/client";
import { currentQualification } from "@/lib/instagram-inbox/qualification";
import { storeInstagramMessage } from "@/lib/instagram-inbox/store";
import { getOutreachSettings, outreachActive, type OutreachSettings } from "./settings";
import { trackedLink } from "./booking";
import { planOutreach, type OutreachPlan } from "./plan";
import { extractFrenchMobile } from "./phone";
import { isWhatsappOptedOut, sendOutreachTemplate } from "./whatsapp";

const LEASE_MS = 5 * 60000;
const BATCH = 10;
const MAX_ATTEMPTS = 3;
const RETRY_MS = 3600000;

/** CHAUD/TIEDE conversations with a fresh inbound and no sequence yet. Existing rows are never touched. */
async function autoEnrol(now: Date) {
  const rows = await prisma.instagramConversation.findMany({
    where: { qualification: { in: ["CHAUD", "TIEDE"] }, qualificationPending: false, resolvedAt: null, lastInboundAt: { gt: new Date(now.getTime() - 24 * 3600000) }, outreach: { is: null } },
    select: { id: true }, take: 50,
  });
  if (rows.length) await prisma.outreachSequence.createMany({ data: rows.map(r => ({ conversationId: r.id, nextRunAt: now })), skipDuplicates: true });
}

const attemptsSoFar = (lastError: string | null) => Number(/^tentative (\d+)/.exec(lastError ?? "")?.[1] ?? 0);

async function sendWhatsapp(conversationId: string, plan: Extract<OutreachPlan, { kind: "send_whatsapp" }>, phone: string, displayName: string, linkToken: string, settings: OutreachSettings, now: Date) {
  const wamid = await sendOutreachTemplate({ to: phone, template: plan.template === 1 ? settings.template1 : settings.template2, language: settings.templateLang, displayName, buttonParam: linkToken });
  const text = `[WhatsApp] Relance démo envoyée au ${phone}`;
  await prisma.instagramMessage.upsert({ where: { id: `wa:${wamid}` }, create: { id: `wa:${wamid}`, conversationId, incoming: false, text, sentAt: now }, update: {} });
  await prisma.instagramConversation.updateMany({ where: { id: conversationId, lastMessageAt: { lt: now } }, data: { lastMessageAt: now } });
}

async function sendInstagram(participantId: string, text: string) {
  const config = await inboxConfig();
  if (!config) throw new Error("Connexion non configurée.");
  const sent = await metaRequest<{ message_id: string }>(`${config.accountId}/messages`, { method: "POST", body: { recipient: { id: participantId }, message: { text } } }, config);
  await storeInstagramMessage(config.accountId, { id: sent.message_id, participantId, incoming: false, text, sentAt: new Date() });
}

async function createTask(conversationId: string, salon: { id: string; assignedToId: string | null } | null, now: Date) {
  if (!salon?.assignedToId) return;
  await prisma.salesTask.upsert({ where: { requestKey: `outreach:${conversationId}` }, update: {}, create: {
    requestKey: `outreach:${conversationId}`, title: "Relancer pour la démo (pas de WhatsApp)", dueAt: now, assignedToId: salon.assignedToId, salonId: salon.id, instagramConversationId: conversationId,
    context: "La séquence de relance Instagram → WhatsApp est terminée sans numéro de téléphone. Relancer pour proposer une démo.",
  } });
}

async function runOne(conversationId: string, settings: OutreachSettings, now: Date) {
  const seq = await prisma.outreachSequence.findUnique({ where: { conversationId }, include: { conversation: { include: { salon: true } } } });
  if (!seq || seq.status !== "ACTIVE") return;
  const { conversation } = seq;
  const messages = (await prisma.instagramMessage.findMany({ where: { conversationId, incoming: true }, orderBy: [{ sentAt: "desc" }, { id: "desc" }], take: 50 })).reverse();
  const lastIncoming = messages[messages.length - 1] ?? null;
  const phone = seq.phone ?? (seq.lastSentAt ? null : extractFrenchMobile(messages.map(m => m.text)));
  const replies = seq.lastSentAt ? messages.filter(m => m.sentAt > seq.lastSentAt!) : [];
  const whatsappNext = seq.step >= 2 || (replies.length > 0 && !seq.phone);
  const target = phone ?? extractFrenchMobile(replies.slice(-1).map(m => m.text));
  const optedOut = whatsappNext && target ? await isWhatsappOptedOut(target) : false;
  const plan = planOutreach({
    step: seq.step, startedAt: seq.startedAt, lastSentAt: seq.lastSentAt, phone, lastInboundAt: conversation.lastInboundAt, resolvedAt: conversation.resolvedAt,
    qualification: currentQualification(conversation, lastIncoming) ? conversation.qualification : null, replies,
    salon: conversation.salon, optedOut, now, settings, calendarUrl: trackedLink(seq.linkToken), name: conversation.salon?.name || conversation.username || "toi",
  });
  const done = { leaseAt: null, lastError: null };
  const save = (data: Prisma.OutreachSequenceUncheckedUpdateInput) => prisma.outreachSequence.update({ where: { conversationId }, data: { ...done, ...(phone !== seq.phone ? { phone } : {}), ...data } });
  const displayName = conversation.salon?.name || conversation.username || "ton salon";
  try {
    switch (plan.kind) {
      case "stop": return void await save({ status: "STOPPED", stopReason: plan.reason, nextRunAt: null });
      case "done": return void await save({ status: "DONE", nextRunAt: null });
      case "wait": return void await save({ nextRunAt: plan.nextRunAt, lastError: seq.lastError });
      case "skip": return void await save({ step: plan.toStep, nextRunAt: plan.nextRunAt, ...(plan.phone ? { phone: plan.phone } : {}), ...(plan.ackAt ? { lastSentAt: plan.ackAt } : {}) });
      case "create_task": await createTask(conversationId, conversation.salon, now); return void await save({ step: 4, status: "DONE", nextRunAt: null });
      case "send_instagram":
        await sendInstagram(conversation.participantId, plan.text);
        return void await save({ step: plan.step + 1, lastSentAt: now, nextRunAt: now });
      case "send_whatsapp":
        await sendWhatsapp(conversationId, plan, phone!, displayName, seq.linkToken, settings, now);
        return void await save(plan.step === 3 ? { step: 4, status: "DONE", lastSentAt: now, nextRunAt: null } : { step: 3, lastSentAt: now, nextRunAt: now });
    }
  } catch (e) {
    const attempt = attemptsSoFar(seq.lastError) + 1;
    const lastError = `tentative ${attempt}/${MAX_ATTEMPTS} : ${e instanceof Error ? e.message.slice(0, 160) : "envoi impossible"}`;
    await save(attempt >= MAX_ATTEMPTS ? { status: "STOPPED", stopReason: "SEND_FAILED", nextRunAt: null, lastError } : { nextRunAt: new Date(now.getTime() + RETRY_MS), lastError });
  }
}

export async function processOutreach(now = new Date()) {
  const settings = await getOutreachSettings();
  if (!outreachActive(settings)) return;
  if (settings.autoStart) await autoEnrol(now);
  const stale = new Date(now.getTime() - LEASE_MS);
  const due = await prisma.outreachSequence.findMany({ where: { status: "ACTIVE", nextRunAt: { lte: now }, OR: [{ leaseAt: null }, { leaseAt: { lt: stale } }] }, orderBy: { nextRunAt: "asc" }, take: BATCH, select: { conversationId: true } });
  for (const { conversationId } of due) {
    const claimed = await prisma.outreachSequence.updateMany({ where: { conversationId, status: "ACTIVE", nextRunAt: { lte: now }, OR: [{ leaseAt: null }, { leaseAt: { lt: stale } }] }, data: { leaseAt: now } });
    if (!claimed.count) continue;
    try { await runOne(conversationId, settings, now); }
    catch { await prisma.outreachSequence.updateMany({ where: { conversationId }, data: { leaseAt: null } }); }
  }
}

export function startOutreachWorker() {
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try { await processOutreach(); }
    catch { console.error("Le service de relance Instagram est temporairement indisponible."); }
    finally { running = false; }
  };
  void poll();
  const timer = setInterval(() => { void poll(); }, 60000); timer.unref();
  return () => clearInterval(timer);
}
