"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireMember, prospectScope } from "@/lib/access";
import { parisDeadline } from "@/lib/crm-format";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createSalesTask(fd: FormData) {
  const user = await requireMember();
  let error: string | null = null;
  try {
    const d = z.object({ requestKey: z.uuid(), title: z.string().trim().min(1).max(200), context: z.string().trim().max(4000).optional(), dueAt: z.string(), assignedToId: z.string().min(1), prospectId: z.string().optional(), salonId: z.string().optional() }).parse(Object.fromEntries(fd));
    const assignedToId = user.role === "ADMIN" ? d.assignedToId : user.id;
    if (!await prisma.user.findFirst({ where: { id: assignedToId, active: true } })) throw new Error("Le responsable doit être un membre actif.");
    if (d.prospectId) {
      const lead = await prisma.prospect.findFirst({ where: { id: d.prospectId, ...prospectScope(user), status: { in: ["NOUVEAU", "EN_TOURNEE", "CONVERTI"] } }, include: { tournee: true } });
      if (!lead) throw new Error("Prospect inaccessible.");
      const owner = lead.assignedToId ?? lead.tournee?.assignedToId;
      if (owner !== assignedToId) throw new Error("Attribuez d’abord le prospect à ce responsable depuis la base de prospects.");
    }
    if (d.salonId && !await prisma.salon.findFirst({ where: { id: d.salonId, archivedAt: null, assignedToId } })) throw new Error("Le salon doit être attribué au responsable de la tâche.");
    await prisma.salesTask.upsert({ where: { requestKey: d.requestKey }, update: {}, create: { requestKey: d.requestKey, title: d.title, context: d.context || null, dueAt: parisDeadline(d.dueAt), assignedToId, prospectId: d.prospectId || null, salonId: d.salonId || null } });
  } catch (e) { error = e instanceof z.ZodError ? "Vérifiez les champs du formulaire." : e instanceof Error ? e.message : "Impossible de créer la tâche."; }
  revalidatePath("/taches"); revalidatePath("/dashboard"); revalidatePath("/prospection");
  redirect(`/taches${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

export async function finishSalesTask(fd: FormData) {
  const user = await requireMember();
  const d = z.object({ id: z.string().min(1), outcome: z.string().trim().min(1).max(4000) }).parse(Object.fromEntries(fd));
  const changed = await prisma.salesTask.updateMany({ where: { id: d.id, doneAt: null, ...(user.role === "ADMIN" ? {} : { assignedToId: user.id }) }, data: { doneAt: new Date(), outcome: d.outcome } });
  if (!changed.count) throw new Error("Tâche inaccessible ou déjà terminée.");
  revalidatePath("/taches"); revalidatePath("/dashboard"); revalidatePath("/prospection");
}
