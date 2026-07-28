"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isDailyPriorityActive, startOfDay } from "@/lib/dailyPriority";
import { geocodeAddress } from "@/lib/geocode";
import { uniqueSalonSlug } from "@/lib/slugs";
import { EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { defaultEmailFrom } from "@/lib/email";
import { decrypt } from "@/lib/crypto";
import { canRevealOnboardingPassword } from "@/lib/onboarding-access";
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

const uniqueSlug = uniqueSalonSlug;

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

function optionalString(value: FormDataEntryValue | null): string | undefined {
  const next = value?.toString().trim();
  return next || undefined;
}

function parseOptionalNumber(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
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

// Prisma throws P2002 when a unique index rejects a write; `target` names the
// column(s) that collided.
function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: string; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  return Array.isArray(target) ? target.includes(column) : target === column;
}

export async function createSalon(fd: FormData) {
  const me = await requireCurrentUser();

  // Double-submit guard. The form ships a token minted once per render, so every
  // click on the same form resolves to the same salon instead of another row.
  // The disabled button in SubmitButton stops the common case, but only this
  // unique key stops genuinely concurrent POSTs — which is what produced 32
  // copies of one salon in 74 seconds on 2026-06-15.
  const token = optionalString(fd.get("formToken"));
  const externalRef = token ? `manual:${token}` : null;

  if (externalRef) {
    const existing = await prisma.salon.findUnique({ where: { externalRef }, select: { id: true } });
    if (existing) redirect(`/salons/${existing.id}`);
  }

  const d = await parse(fd);

  let salon;
  try {
    salon = await prisma.salon.create({
      data: { ...d, slug: await uniqueSlug(d.name), source: "MANUAL", assignedToId: me.id, externalRef },
    });
  } catch (error) {
    // Lost a race against a concurrent submit of the same form: the winner
    // already created the salon, so land on it rather than showing an error.
    if (externalRef && isUniqueViolationOn(error, "externalRef")) {
      const winner = await prisma.salon.findUnique({ where: { externalRef }, select: { id: true } });
      if (winner) redirect(`/salons/${winner.id}`);
    }
    throw error;
  }

  revalidatePath("/salons");
  redirect(`/salons/${salon.id}`);
}

export async function updateSalon(id: string, fd: FormData) {
  const me = await assertCanAccessSalon(id);
  const d = await parse(fd);
  // Reassignment is admin-only — enforced here, never trust the (hidden-for-reps) form field.
  const assignedToId = me.role === "ADMIN" ? optionalString(fd.get("assignedToId")) : undefined;
  // "Priorité du jour" checkbox: present → keep/pin for today, absent → clear.
  const priorityDate = fd.has("priorityToday") ? startOfDay() : null;
  await prisma.salon.update({
    where: { id },
    data: { ...d, slug: await uniqueSlug(d.name, id), priorityDate, ...(assignedToId ? { assignedToId } : {}) },
  });
  revalidatePath(`/salons/${id}`);
  revalidatePath("/salons");
  revalidatePath("/dashboard");
  redirect(`/salons/${id}`);
}

// Toggle the "priorité du jour" pin. Pins for today, or clears if already active.
// Routes to the assignee's dashboard via the salon's assignedToId.
export async function setDailyPriority(salonId: string) {
  await assertCanAccessSalon(salonId);
  const salon = await prisma.salon.findUnique({ where: { id: salonId }, select: { priorityDate: true } });
  const priorityActive = isDailyPriorityActive(salon?.priorityDate);
  await prisma.salon.update({ where: { id: salonId }, data: { priorityDate: priorityActive ? null : startOfDay() } });
  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/dashboard");
  revalidatePath("/salons");
}

export async function changeStatus(salonId: string, fd: FormData) {
  await assertCanAccessSalon(salonId);
  await prisma.salon.update({ where: { id: salonId }, data: { status: fd.get("status") as SalonStatus, priorityDate: null } });
  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/salons");
  revalidatePath("/dashboard");
}

export async function logActivity(salonId: string, fd: FormData) {
  const me = await assertCanAccessSalon(salonId);
  const type = fd.get("type") as ActivityType;
  const notes = (fd.get("notes") || "").toString().trim();
  await prisma.activity.create({ data: { salonId, userId: me.id, type, notes: notes || null } });
  await prisma.salon.update({ where: { id: salonId }, data: { lastContactedAt: new Date(), priorityDate: null } });
  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/salons");
  revalidatePath("/dashboard");
}

export async function addReminder(salonId: string, fd: FormData) {
  const me = await assertCanAccessSalon(salonId);
  const title = (fd.get("title") || "").toString().trim();
  const dueAt = new Date((fd.get("dueAt") || "").toString());
  if (!title || isNaN(dueAt.getTime())) return;
  await prisma.reminder.create({ data: { salonId, userId: me.id, title, dueAt } });
  await prisma.salon.update({ where: { id: salonId }, data: { nextActionAt: dueAt, priorityDate: null } });
  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/salons");
  revalidatePath("/dashboard");
}

export async function completeReminder(reminderId: string, salonId: string) {
  await assertCanAccessSalon(salonId);
  await prisma.$transaction([
    prisma.reminder.update({ where: { id: reminderId }, data: { done: true, doneAt: new Date() } }),
    prisma.salon.update({ where: { id: salonId }, data: { priorityDate: null } }),
  ]);
  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/salons");
  revalidatePath("/dashboard");
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

  await prisma.salon.update({ where: { id: salonId }, data: { lastContactedAt: new Date(), priorityDate: null } });
  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/salons");
  revalidatePath("/dashboard");
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

  // Enqueue-only: the out-of-process onboarding worker
  // (scripts/process-onboarding-jobs.ts) polls QUEUED rows and runs the
  // expand → extract → create-account pipeline. It reads everything it needs
  // (booking URL + CRM hints) from the salon row itself, so this action just
  // creates the job and returns. (The old inline `startOnboardingJob` spawn
  // was the stuck-QUEUED bug: it shelled out to a `claude` binary absent from
  // the Docker image.)
  await prisma.$transaction([
    prisma.onboardingJob.create({
      data: {
        salonId,
        requestedById: user.id,
        sourceUrl: salon.bookingUrl,
        sourceType: salon.bookingTool.toLowerCase(),
        status: "QUEUED",
      },
    }),
    prisma.salon.update({ where: { id: salonId }, data: { priorityDate: null } }),
  ]);
  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/salons");
  revalidatePath("/dashboard");
}

export type RevealPasswordResult = { ok: true; password: string } | { ok: false; error: string };

/**
 * Decrypts an onboarded account's password for one-off display in the CRM.
 *
 * The plaintext exists only in this action's return value — it is never part of
 * the salon page's payload, so a password stays encrypted at rest and out of the
 * HTML until someone deliberately asks for it. Every successful reveal writes an
 * OnboardingJobEvent so there is a trail of who read which credential and when.
 *
 * Returns an envelope instead of throwing: Next.js redacts server-action errors
 * in production, so a thrown message would reach the operator as a generic
 * "an error occurred" with no way to tell "not your salon" from "key missing".
 *
 * Deliberately does NOT revalidatePath: re-rendering the salon page would wipe
 * the revealed value out of the client component holding it.
 */
export async function revealOnboardingPassword(jobId: string): Promise<RevealPasswordResult> {
  const user = await currentUser();
  if (!canRevealOnboardingPassword(user)) return { ok: false, error: "Non authentifié" };

  const job = await prisma.onboardingJob.findUnique({
    where: { id: jobId },
    select: { id: true, loginPassword: true },
  });
  if (!job) return { ok: false, error: "Job d'onboarding introuvable" };
  if (!job.loginPassword) return { ok: false, error: "Aucun mot de passe enregistré pour ce job" };

  let password: string;
  try {
    password = decrypt(job.loginPassword);
  } catch {
    // Wrong/rotated ENCRYPTION_KEY, or a row written before encryption landed.
    // Never surface the ciphertext or the underlying crypto error to the UI.
    return { ok: false, error: "Déchiffrement impossible — vérifie ENCRYPTION_KEY sur le serveur" };
  }

  try {
    await auditPasswordReveal(jobId, user.id, user.email ?? null);

  } catch {
    // No trail, no credential.
    return { ok: false, error: "Journalisation impossible — mot de passe non affiché" };
  }

  return { ok: true, password };
}

/**
 * Appends a `password_revealed` event to the job's log. Sequences are unique
 * per job, so two reveals racing for the same number is a real (if unlikely)
 * outcome — retry on collision rather than failing a legitimate reveal.
 *
 * An audit write that fails must fail the reveal: silently handing out a
 * credential with no trail is exactly what this event exists to prevent.
 */
async function auditPasswordReveal(jobId: string, userId: string, userEmail: string | null): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const agg = await prisma.onboardingJobEvent.aggregate({ where: { jobId }, _max: { sequence: true } });
    try {
      await prisma.onboardingJobEvent.create({
        data: {
          jobId,
          sequence: (agg._max.sequence ?? 0) + 1,
          stream: "system",
          type: "password_revealed",
          level: "info",
          text: `Mot de passe révélé par ${userEmail ?? userId}`,
          data: { userId, userEmail },
        },
      });
      return;
    } catch (error) {
      const isSequenceCollision = (error as { code?: string } | undefined)?.code === "P2002";
      if (!isSequenceCollision || attempt === MAX_ATTEMPTS) throw error;
    }
  }
}
