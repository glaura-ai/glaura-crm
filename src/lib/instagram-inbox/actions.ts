"use server";
import { z } from "zod";
import { requireInstagramAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { syncInstagramHistory } from "./sync";
import { syncFirebaseInbox } from "./firebase-sync";
import { inboxConfig, metaRequest } from "./client";
import { storeInstagramMessage } from "./store";
import { instagramReplyAllowed } from "./security";
import { inboxHref } from "./tracking";
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
  const location = inboxHref(Object.fromEntries(new URLSearchParams(String(fd.get("returnQuery") || ""))), { conversation: id });
  redirect(`${location}${error ? `${location.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}` : ""}`);
}

export async function syncInstagramInbox(fd: FormData) {
  return inboxAction(fd, async () => {
    await syncInstagramHistory();
    await syncFirebaseInbox();
  });
}

export async function replyInstagram(fd: FormData) {
  return inboxAction(fd, async id => {
    const text = z.string().trim().min(1).max(1000).parse(fd.get("text"));
    const conversation = await prisma.instagramConversation.findUniqueOrThrow({ where: { id } });
    if (!instagramReplyAllowed(conversation.lastInboundAt)) throw new Error("La fenêtre de réponse de 24 heures est fermée. Consultez Instagram pour les autres possibilités de réponse.");
    const config = await inboxConfig();
    if (!config) throw new Error("Connexion non configurée.");
    const sent = await metaRequest<{ message_id: string }>(`${config.accountId}/messages`, { method: "POST", body: { recipient: { id: conversation.participantId }, message: { text } } }, config);
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

export async function setInstagramConversationState(fd: FormData) {
  return inboxAction(fd, async id => {
    const state = z.enum(["open", "waiting", "done"]).parse(fd.get("state"));
    await prisma.instagramConversation.update({ where: { id }, data: {
      resolvedAt: state === "done" ? new Date() : null,
      waitingAt: state === "waiting" ? new Date() : null,
    } });
  });
}
