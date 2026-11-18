"use server";
import { z } from "zod";
import { requireInstagramAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { inboxHref } from "@/lib/instagram-inbox/tracking";
import { getOutreachSettings, outreachActive } from "./settings";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function outreachAction(fd: FormData, work: (id: string, userId: string) => Promise<void>) {
  const user = await requireInstagramAdmin();
  const id = typeof fd.get("conversationId") === "string" ? String(fd.get("conversationId")) : "";
  let error: string | null = null;
  try {
    z.string().min(1).parse(id);
    if (!await prisma.instagramConversation.findUnique({ where: { id }, select: { id: true } })) throw new Error("Conversation introuvable.");
    await work(id, user.id);
  } catch (e) { error = e instanceof z.ZodError ? "Vérifiez les champs du formulaire." : e instanceof Error ? e.message : "Opération impossible."; }
  revalidatePath("/instagram"); revalidatePath("/salons");
  const location = inboxHref(Object.fromEntries(new URLSearchParams(String(fd.get("returnQuery") || ""))), { conversation: id });
  redirect(`${location}${error ? `${location.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}` : ""}`);
}

export async function startOutreach(fd: FormData) {
  return outreachAction(fd, async (id, userId) => {
    if (!outreachActive(await getOutreachSettings())) throw new Error("La séquence automatique est désactivée.");
    const conversation = await prisma.instagramConversation.findUnique({ where: { id }, include: { outreach: true } });
    if (conversation?.outreach) throw new Error("Une séquence a déjà été lancée pour cette conversation.");
    if (conversation?.qualification === "FROID" || conversation?.resolvedAt) throw new Error("Cette conversation est froide ou déjà traitée.");
    await prisma.outreachSequence.create({ data: { conversationId: id, status: "ACTIVE", step: 0, nextRunAt: new Date(), startedById: userId } });
  });
}

const stop = (conversationId: string, stopReason: string) => ({ where: { conversationId, status: "ACTIVE" }, data: { status: "STOPPED", stopReason, nextRunAt: null } });

export async function stopOutreach(fd: FormData) {
  return outreachAction(fd, async id => { await prisma.outreachSequence.updateMany(stop(id, "MANUAL")); });
}

export async function markDemoBooked(fd: FormData) {
  return outreachAction(fd, async id => {
    const conversation = await prisma.instagramConversation.findUnique({ where: { id }, select: { salonId: true } });
    await prisma.$transaction(async tx => {
      await tx.outreachSequence.updateMany(stop(id, "DEMO_BOOKED"));
      if (conversation?.salonId) await tx.salon.updateMany({ where: { id: conversation.salonId, archivedAt: null, OR: [{ accountStatusLabel: null }, { accountStatusLabel: "demo_to_book" }] }, data: { accountStatusLabel: "demo_booked" } });
      await tx.instagramConversation.update({ where: { id }, data: { waitingAt: null, resolvedAt: new Date() } });
    });
  });
}
