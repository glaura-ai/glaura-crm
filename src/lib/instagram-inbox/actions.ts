"use server";
import { z } from "zod";
import { requireInstagramAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { inboxConfig, metaRequest } from "./client";
import { storeInstagramMessage } from "./store";
import { instagramReplyAllowed } from "./security";
import { parisDeadline } from "@/lib/crm-format";
import { uniqueSalonSlug } from "@/lib/slugs";
import { normalizeInstagramHandle } from "@/lib/instagram";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function inboxAction(fd: FormData, work: (id: string) => Promise<void>) {
  await requireInstagramAdmin();
  const id = typeof fd.get("conversationId") === "string" ? String(fd.get("conversationId")) : "";
  let error: string | null = null;
  try { await work(id); } catch (e) { error = e instanceof z.ZodError ? "Vérifiez les champs du formulaire." : e instanceof Error ? e.message : "Opération impossible."; }
  revalidatePath("/instagram"); revalidatePath("/taches"); revalidatePath("/salons");
  redirect(`/instagram?conversation=${encodeURIComponent(id)}${error ? `&error=${encodeURIComponent(error)}` : ""}`);
}

type MetaPage<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };
type MetaMessage = { id: string; message?: string; from?: { id: string; username?: string }; created_time: string };
export async function syncInstagramInbox(fd: FormData) {
  return inboxAction(fd, async () => {
    const config = inboxConfig();
    if (!config) throw new Error("La connexion de messagerie Instagram n’est pas configurée.");
    let after: string | undefined;
    // Bounded import, repeated safely through message-ID upserts. Webhooks maintain new messages.
    for (let page = 0; page < 5; page++) {
      const conversations: MetaPage<{ id: string; participants?: { data: { id: string; username?: string }[] } }> = await metaRequest(`${config.accountId}/conversations?platform=instagram&fields=id,participants&limit=20${after ? `&after=${encodeURIComponent(after)}` : ""}`);
      for (const conversation of conversations.data ?? []) {
        const participant = conversation.participants?.data.find(p => p.id !== config.accountId);
        if (!participant) continue;
        let messageAfter: string | undefined;
        for (let mPage = 0; mPage < 5; mPage++) {
          const messages: MetaPage<MetaMessage> = await metaRequest(`${encodeURIComponent(conversation.id)}/messages?fields=id,message,from,created_time&limit=20${messageAfter ? `&after=${encodeURIComponent(messageAfter)}` : ""}`);
          for (const m of messages.data ?? []) {
            const sentAt = new Date(m.created_time);
            if (!m.from?.id || !Number.isFinite(sentAt.getTime())) continue;
            await storeInstagramMessage(config.accountId, { id: m.id, participantId: participant.id, username: participant.username, incoming: m.from.id !== config.accountId, text: m.message || "[Pièce jointe — consulter Instagram]", sentAt });
          }
          messageAfter = messages.paging?.next ? messages.paging.cursors?.after : undefined;
          if (!messageAfter) break;
        }
      }
      after = conversations.paging?.next ? conversations.paging.cursors?.after : undefined;
      if (!after) break;
    }
  });
}

export async function replyInstagram(fd: FormData) {
  return inboxAction(fd, async id => {
    const text = z.string().trim().min(1).max(1000).parse(fd.get("text"));
    const conversation = await prisma.instagramConversation.findUniqueOrThrow({ where: { id } });
    if (!instagramReplyAllowed(conversation.lastInboundAt)) throw new Error("La fenêtre de réponse de 24 heures est fermée. Consultez Instagram pour les autres possibilités de réponse.");
    const config = inboxConfig();
    if (!config) throw new Error("Connexion non configurée.");
    const sent = await metaRequest<{ message_id: string }>(`${config.accountId}/messages`, { method: "POST", body: { recipient: { id: conversation.participantId }, message: { text } } });
    await storeInstagramMessage(config.accountId, { id: sent.message_id, participantId: conversation.participantId, incoming: false, text, sentAt: new Date() });
  });
}

export async function linkInstagramSalon(fd: FormData) {
  return inboxAction(fd, async id => {
    const conversation = await prisma.instagramConversation.findUniqueOrThrow({ where: { id } });
    const salonId = String(fd.get("salonId") || "");
    if (salonId) {
      if (!await prisma.salon.findFirst({ where: { id: salonId, archivedAt: null } })) throw new Error("Salon introuvable.");
      await prisma.instagramConversation.update({ where: { id }, data: { salonId } });
    } else {
      const name = z.string().trim().min(1).max(200).parse(fd.get("name"));
      if (conversation.salonId) throw new Error("Cette conversation est déjà liée à un salon.");
      const handle = normalizeInstagramHandle(conversation.username);
      if (handle && await prisma.salon.findFirst({ where: { instagram: handle, archivedAt: null } })) throw new Error("Un salon porte déjà ce compte Instagram. Recherchez-le et liez-le à la conversation.");
      await prisma.$transaction(async tx => {
        const salon = await tx.salon.create({ data: { name, slug: await uniqueSalonSlug(name), instagram: handle, source: "MANUAL", sourceLabel: "Instagram — message entrant" } });
        await tx.instagramConversation.update({ where: { id }, data: { salonId: salon.id } });
      });
    }
  });
}

export async function createTaskFromInstagram(fd: FormData) {
  return inboxAction(fd, async id => {
    const d = z.object({ requestKey: z.uuid(), title: z.string().trim().min(1).max(200), context: z.string().trim().max(4000), assignedToId: z.string().min(1), dueAt: z.string() }).parse(Object.fromEntries(fd));
    const conversation = await prisma.instagramConversation.findUniqueOrThrow({ where: { id } });
    if (!conversation.salonId) throw new Error("Liez d’abord cette conversation à un salon.");
    if (!await prisma.user.findFirst({ where: { id: d.assignedToId, active: true } })) throw new Error("Choisissez un responsable actif.");
    await prisma.$transaction(async tx => {
      const salon = await tx.salon.findUniqueOrThrow({ where: { id: conversation.salonId! } });
      if (salon.assignedToId && salon.assignedToId !== d.assignedToId) throw new Error("Choisissez le responsable du salon ou réattribuez sa fiche avant de créer la tâche.");
      await tx.salon.update({ where: { id: salon.id }, data: { assignedToId: d.assignedToId } });
      await tx.salesTask.upsert({ where: { requestKey: d.requestKey }, update: {}, create: { requestKey: d.requestKey, title: d.title, context: d.context || null, dueAt: parisDeadline(d.dueAt), assignedToId: d.assignedToId, salonId: salon.id, instagramConversationId: id } });
    });
  });
}

export async function resolveInstagramConversation(fd: FormData) {
  return inboxAction(fd, async id => { await prisma.instagramConversation.update({ where: { id }, data: { resolvedAt: new Date() } }); });
}
