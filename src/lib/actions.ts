"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { ActivityType, BookingTool, Metier, SalonStatus, SalonType } from "@/generated/prisma/enums";

async function currentUser() {
  const s = await auth();
  return s?.user ?? null;
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || "salon";
  let slug = base;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.salon.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${i++}`;
  }
}

const salonSchema = z.object({
  name: z.string().min(1, "Nom requis"),
  metier: z.array(z.string()).default([]),
  type: z.string().optional(),
  arrondissement: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  instagram: z.string().optional(),
  bookingTool: z.string().optional(),
  bookingUrl: z.string().optional(),
  status: z.string().optional(),
});

function parse(fd: FormData) {
  const d = salonSchema.parse({
    name: fd.get("name"),
    metier: fd.getAll("metier").map(String),
    type: (fd.get("type") || undefined) as string | undefined,
    arrondissement: (fd.get("arrondissement") || undefined) as string | undefined,
    address: (fd.get("address") || undefined) as string | undefined,
    phone: (fd.get("phone") || undefined) as string | undefined,
    instagram: ((fd.get("instagram") || "").toString().replace(/^@/, "") || undefined) as string | undefined,
    bookingTool: (fd.get("bookingTool") || undefined) as string | undefined,
    bookingUrl: (fd.get("bookingUrl") || undefined) as string | undefined,
    status: (fd.get("status") || undefined) as string | undefined,
  });
  return {
    name: d.name,
    metier: d.metier as Metier[],
    type: (d.type as SalonType) || null,
    arrondissement: d.arrondissement || null,
    address: d.address || null,
    phone: d.phone || null,
    instagram: d.instagram || null,
    bookingTool: (d.bookingTool as BookingTool) || "NONE",
    bookingUrl: d.bookingUrl || null,
    status: (d.status as SalonStatus) || "A_VISITER",
  };
}

export async function createSalon(fd: FormData) {
  const me = await currentUser();
  const d = parse(fd);
  const salon = await prisma.salon.create({
    data: { ...d, slug: await uniqueSlug(d.name), source: "MANUAL", assignedToId: me?.id ?? null },
  });
  revalidatePath("/salons");
  redirect(`/salons/${salon.id}`);
}

export async function updateSalon(id: string, fd: FormData) {
  const d = parse(fd);
  await prisma.salon.update({ where: { id }, data: { ...d, slug: await uniqueSlug(d.name, id) } });
  revalidatePath(`/salons/${id}`);
  revalidatePath("/salons");
  redirect(`/salons/${id}`);
}

export async function changeStatus(salonId: string, fd: FormData) {
  await prisma.salon.update({ where: { id: salonId }, data: { status: fd.get("status") as SalonStatus } });
  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/salons");
}

export async function logActivity(salonId: string, fd: FormData) {
  const me = await currentUser();
  const type = fd.get("type") as ActivityType;
  const notes = (fd.get("notes") || "").toString().trim();
  await prisma.activity.create({ data: { salonId, userId: me?.id ?? null, type, notes: notes || null } });
  await prisma.salon.update({ where: { id: salonId }, data: { lastContactedAt: new Date() } });
  revalidatePath(`/salons/${salonId}`);
}

export async function addReminder(salonId: string, fd: FormData) {
  const me = await currentUser();
  const title = (fd.get("title") || "").toString().trim();
  const dueAt = new Date((fd.get("dueAt") || "").toString());
  if (!title || isNaN(dueAt.getTime())) return;
  await prisma.reminder.create({ data: { salonId, userId: me?.id ?? null, title, dueAt } });
  await prisma.salon.update({ where: { id: salonId }, data: { nextActionAt: dueAt } });
  revalidatePath(`/salons/${salonId}`);
}

export async function completeReminder(reminderId: string, salonId: string) {
  await prisma.reminder.update({ where: { id: reminderId }, data: { done: true, doneAt: new Date() } });
  revalidatePath(`/salons/${salonId}`);
}

// Account-readiness: queue an onboarding job for the VPS engine.
// Gate: assigned rep or admin; status must be SIGNE unless admin overrides.
// (Actual engine call to run-onboard.sh is wired later; here we persist the job.)
export async function triggerOnboarding(salonId: string) {
  const user = await currentUser();
  if (!user) throw new Error("Non authentifié");
  const salon = await prisma.salon.findUnique({ where: { id: salonId } });
  if (!salon) throw new Error("Salon introuvable");

  const isAdmin = user.role === "ADMIN";
  if (!isAdmin && salon.assignedToId !== user.id) throw new Error("Réservé au commercial assigné ou à un admin");
  if (!isAdmin && salon.status !== "SIGNE") throw new Error("Le salon doit être au statut Signé");
  if (!salon.bookingUrl) throw new Error("Aucune URL de réservation à scraper");

  await prisma.onboardingJob.create({
    data: { salonId, requestedById: user.id, sourceUrl: salon.bookingUrl, status: "QUEUED" },
  });
  revalidatePath(`/salons/${salonId}`);
}
