"use server";
import { z } from "zod";
import { requireAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function saveMember(fd: FormData) {
  const me = await requireAdmin();
  let error: string | null = null;
  try {
    const d = z.object({ email: z.email().transform(s => s.trim().toLowerCase()), name: z.string().trim().min(1).max(100) }).parse(Object.fromEntries(fd));
    if (await prisma.user.findUnique({ where: { email: d.email } })) throw new Error("Ce membre existe déjà. Gérez son accès ci-dessous.");
    await prisma.user.create({ data: { ...d, role: "COMMERCIAL", active: true, accessGrantedAt: new Date() } });
  } catch (e) { error = e instanceof z.ZodError ? "Saisissez un nom et une adresse email valides." : e instanceof Error ? e.message : "Impossible d’ajouter ce membre."; }
  void me;
  revalidatePath("/administration");
  redirect(`/administration${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

export async function setMemberActive(fd: FormData) {
  const me = await requireAdmin();
  const id = z.string().min(1).parse(fd.get("id"));
  if (id === me.id) throw new Error("Vous ne pouvez pas désactiver votre propre compte.");
  const active = fd.get("active") === "true";
  await prisma.user.update({ where: { id }, data: { active, ...(active ? { accessGrantedAt: new Date() } : {}) } });
  revalidatePath("/administration"); revalidatePath("/prospection");
}

export async function transferMemberWork(fd: FormData) {
  await requireAdmin();
  const d = z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(Object.fromEntries(fd));
  if (d.from === d.to) throw new Error("Choisissez deux membres différents.");
  if (!await prisma.user.findFirst({ where: { id: d.to, active: true } })) throw new Error("Le nouveau responsable doit être actif.");
  await prisma.$transaction(async tx => {
    await tx.salon.updateMany({ where: { assignedToId: d.from }, data: { assignedToId: d.to } });
    // Legacy prospect ownership can come from the round instead of the prospect.
    await tx.prospect.updateMany({ where: { OR: [{ assignedToId: d.from }, { assignedToId: null, tournee: { assignedToId: d.from } }] }, data: { assignedToId: d.to } });
    await tx.tournee.updateMany({ where: { assignedToId: d.from }, data: { assignedToId: d.to } });
    await tx.salesTask.updateMany({ where: { assignedToId: d.from, doneAt: null }, data: { assignedToId: d.to } });
    await tx.reminder.updateMany({ where: { userId: d.from, done: false }, data: { userId: d.to } });
  });
  revalidatePath("/administration"); revalidatePath("/prospection"); revalidatePath("/taches"); revalidatePath("/salons"); revalidatePath("/dashboard");
}
