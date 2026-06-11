"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { defaultEmailFrom } from "@/lib/email";
import type { ActivityType, BookingTool, EmailTemplate, Metier, SalonStatus, SalonType } from "@/generated/prisma/enums";

async function currentUser() {
  const s = await auth();
  return s?.user ?? null;
}

async function requireCurrentUser() {
  const user = await currentUser();
  if (!user?.id) throw new Error("Non authentifié");
  return user;
}

async function assertCanAccessSalon(salonId: string) {
  const user = await requireCurrentUser();
  if (user.role === "ADMIN") return user;

  const salon = await prisma.salon.findUnique({ where: { id: salonId }, select: { assignedToId: true } });
  if (!salon || salon.assignedToId !== user.id) throw new Error("Réservé au commercial assigné ou à un admin");
  return user;
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
  lat: z.string().optional(),
  lng: z.string().optional(),
  phone: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  instagram: z.string().optional(),
  bookingTool: z.string().optional(),
  bookingUrl: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
});

type GeocodedAddress = {
  address: string;
  lat: number;
  lng: number;
};

function optionalString(value: FormDataEntryValue | null): string | undefined {
  const next = value?.toString().trim();
  return next || undefined;
}

function parseOptionalNumber(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

async function geocodeAddress(address: string): Promise<GeocodedAddress | null> {
  try {
    const response = await fetch(`https://api-adresse.data.gouv.fr/search/?limit=1&q=${encodeURIComponent(address)}`);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      features?: Array<{
        properties?: { label?: string };
        geometry?: { coordinates?: number[] };
      }>;
    };
    const feature = data.features?.[0];
    const lng = Number(feature?.geometry?.coordinates?.[0]);
    const lat = Number(feature?.geometry?.coordinates?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      address: feature?.properties?.label?.trim() || address,
      lat,
      lng,
    };
  } catch {
    return null;
  }
}

async function parse(fd: FormData) {
  const d = salonSchema.parse({
    name: fd.get("name"),
    metier: fd.getAll("metier").map(String),
    type: optionalString(fd.get("type")),
    arrondissement: optionalString(fd.get("arrondissement")),
    address: optionalString(fd.get("address")),
    lat: optionalString(fd.get("lat")),
    lng: optionalString(fd.get("lng")),
    phone: optionalString(fd.get("phone")),
    contactName: optionalString(fd.get("contactName")),
    contactEmail: optionalString(fd.get("contactEmail")),
    instagram: cleanInstagram((fd.get("instagram") || "").toString()) || undefined,
    bookingTool: optionalString(fd.get("bookingTool")),
    bookingUrl: optionalString(fd.get("bookingUrl")),
    status: optionalString(fd.get("status")),
    notes: optionalString(fd.get("notes")),
  });
  let address = d.address || null;
  let lat = address ? parseOptionalNumber(d.lat) : null;
  let lng = address ? parseOptionalNumber(d.lng) : null;

  if (address && (lat == null || lng == null)) {
    const geocoded = await geocodeAddress(address);
    if (geocoded) {
      address = geocoded.address;
      lat = geocoded.lat;
      lng = geocoded.lng;
    } else {
      lat = null;
      lng = null;
    }
  }

  return {
    name: d.name,
    metier: d.metier as Metier[],
    type: (d.type as SalonType) || null,
    arrondissement: d.arrondissement || null,
    address,
    lat,
    lng,
    phone: d.phone || null,
    contactName: d.contactName || null,
    contactEmail: d.contactEmail || null,
    instagram: d.instagram || null,
    bookingTool: (d.bookingTool as BookingTool) || "NONE",
    bookingUrl: d.bookingUrl || null,
    status: (d.status as SalonStatus) || "A_VISITER",
    notes: d.notes || null,
  };
}

function cleanInstagram(value: string): string | null {
  const trimmed = value.trim().replace(/^@/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase().includes("instagram.com")) {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }
  } catch {
    // Plain handle.
  }
  return trimmed
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^@/, "") || null;
}

export async function createSalon(fd: FormData) {
  const me = await requireCurrentUser();
  const d = await parse(fd);
  const salon = await prisma.salon.create({
    data: { ...d, slug: await uniqueSlug(d.name), source: "MANUAL", assignedToId: me.id },
  });
  revalidatePath("/salons");
  redirect(`/salons/${salon.id}`);
}

export async function updateSalon(id: string, fd: FormData) {
  const me = await assertCanAccessSalon(id);
  const d = await parse(fd);
  // Reassignment is admin-only — enforced here, never trust the (hidden-for-reps) form field.
  const assignedToId = me.role === "ADMIN" ? optionalString(fd.get("assignedToId")) : undefined;
  await prisma.salon.update({
    where: { id },
    data: { ...d, slug: await uniqueSlug(d.name, id), ...(assignedToId ? { assignedToId } : {}) },
  });
  revalidatePath(`/salons/${id}`);
  revalidatePath("/salons");
  redirect(`/salons/${id}`);
}

function startOfToday(): Date {
  const v = new Date();
  v.setHours(0, 0, 0, 0);
  return v;
}

// Toggle the "priorité du jour" pin. Pins for today, or clears if already pinned today.
// Routes to the assignee's dashboard via the salon's assignedToId.
export async function setDailyPriority(salonId: string) {
  await assertCanAccessSalon(salonId);
  const salon = await prisma.salon.findUnique({ where: { id: salonId }, select: { priorityDate: true } });
  const today = startOfToday();
  const pinnedToday =
    salon?.priorityDate != null && new Date(salon.priorityDate).setHours(0, 0, 0, 0) === today.getTime();
  await prisma.salon.update({ where: { id: salonId }, data: { priorityDate: pinnedToday ? null : today } });
  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/dashboard");
}

export async function changeStatus(salonId: string, fd: FormData) {
  await assertCanAccessSalon(salonId);
  await prisma.salon.update({ where: { id: salonId }, data: { status: fd.get("status") as SalonStatus } });
  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/salons");
}

export async function logActivity(salonId: string, fd: FormData) {
  const me = await assertCanAccessSalon(salonId);
  const type = fd.get("type") as ActivityType;
  const notes = (fd.get("notes") || "").toString().trim();
  await prisma.activity.create({ data: { salonId, userId: me.id, type, notes: notes || null } });
  await prisma.salon.update({ where: { id: salonId }, data: { lastContactedAt: new Date() } });
  revalidatePath(`/salons/${salonId}`);
}

export async function addReminder(salonId: string, fd: FormData) {
  const me = await assertCanAccessSalon(salonId);
  const title = (fd.get("title") || "").toString().trim();
  const dueAt = new Date((fd.get("dueAt") || "").toString());
  if (!title || isNaN(dueAt.getTime())) return;
  await prisma.reminder.create({ data: { salonId, userId: me.id, title, dueAt } });
  await prisma.salon.update({ where: { id: salonId }, data: { nextActionAt: dueAt } });
  revalidatePath(`/salons/${salonId}`);
}

export async function completeReminder(reminderId: string, salonId: string) {
  await assertCanAccessSalon(salonId);
  await prisma.reminder.update({ where: { id: reminderId }, data: { done: true, doneAt: new Date() } });
  revalidatePath(`/salons/${salonId}`);
}

const emailJobSchema = z.object({
  to: z.email(),
  template: z.enum(EMAIL_TEMPLATES),
  subject: z.string().trim().min(2).max(160),
  body: z.string().trim().min(10).max(6000),
});

export async function queueFollowUpEmail(salonId: string, fd: FormData) {
  const me = await assertCanAccessSalon(salonId);
  const payload = emailJobSchema.parse({
    to: (fd.get("to") || "").toString().trim(),
    template: (fd.get("template") || "").toString(),
    subject: (fd.get("subject") || "").toString(),
    body: (fd.get("body") || "").toString(),
  });

  await prisma.emailJob.create({
    data: {
      salonId,
      requestedById: me.id,
      to: payload.to,
      from: defaultEmailFrom(),
      template: payload.template as EmailTemplate,
      subject: payload.subject,
      body: payload.body,
      status: "QUEUED",
    },
  });

  await prisma.salon.update({ where: { id: salonId }, data: { lastContactedAt: new Date() } });
  revalidatePath(`/salons/${salonId}`);
}

// Account-readiness: queue and start an onboarding job for the VPS engine.
// Gate: assigned rep or admin; status must be SIGNE unless admin overrides.
export async function triggerOnboarding(salonId: string) {
  const user = await requireCurrentUser();
  const salon = await prisma.salon.findUnique({ where: { id: salonId } });
  if (!salon) throw new Error("Salon introuvable");

  const isAdmin = user.role === "ADMIN";
  if (!isAdmin && salon.assignedToId !== user.id) throw new Error("Réservé au commercial assigné ou à un admin");
  if (!isAdmin && salon.status !== "SIGNE") throw new Error("Le salon doit être au statut Signé");
  if (!salon.bookingUrl) throw new Error("Aucune URL de réservation à scraper");

  const job = await prisma.onboardingJob.create({
    data: {
      salonId,
      requestedById: user.id,
      sourceUrl: salon.bookingUrl,
      sourceType: salon.bookingTool.toLowerCase(),
      status: "QUEUED",
    },
  });
  const { startOnboardingJob } = await import("@/lib/onboarding");
  await startOnboardingJob(job.id, salon.bookingUrl, {
    crmSalonId: salon.id,
    salonName: salon.name,
    instagram: salon.instagram,
    instagramHandle: salon.instagram,
    address: salon.address,
    lat: salon.lat,
    lng: salon.lng,
    latitude: salon.lat,
    longitude: salon.lng,
    phone: salon.phone,
    contactName: salon.contactName,
    contactEmail: salon.contactEmail,
    bookingTool: salon.bookingTool,
  });
  revalidatePath(`/salons/${salonId}`);
}
