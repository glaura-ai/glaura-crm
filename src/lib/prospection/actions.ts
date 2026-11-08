"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireMember, requireAdmin, prospectScope } from "@/lib/access";
import { parisDateInput, parisDeadline } from "@/lib/crm-format";
import { ZONE_BY_SLUG } from "@/lib/prospection/zones";
import { tierForProspect } from "@/lib/prospection/tier";
import { uniqueSalonSlug } from "@/lib/slugs";
import type { BookingTool, ProspectSource } from "@/generated/prisma/enums";

async function withErrorBanner(work: () => Promise<void>): Promise<never> {
  let error: string | null = null;
  try { await work(); } catch (e) {
    error = e instanceof z.ZodError ? "Vérifiez les champs du formulaire." : e instanceof Error ? e.message : "Erreur inattendue.";
  }
  revalidatePath("/prospection");
  revalidatePath("/taches");
  revalidatePath("/dashboard");
  redirect(error ? `/prospection?error=${encodeURIComponent(error)}` : "/prospection");
}

async function activeAssignee(id: string) {
  const member = await prisma.user.findFirst({ where: { id, active: true } });
  if (!member) throw new Error("Choisissez un membre actif de l’équipe.");
  return member;
}

export async function generateTournee(fd: FormData) {
  await requireAdmin();
  return withErrorBanner(async () => {
    const d = z.object({ zone: z.string().min(1), assignedToId: z.string().min(1), size: z.coerce.number().int().min(1).max(100), minTier: z.coerce.number().int().min(1).max(4) }).parse(Object.fromEntries(fd));
    if (!ZONE_BY_SLUG.has(d.zone)) throw new Error("Zone inconnue.");
    await activeAssignee(d.assignedToId);
    const today = new Date(`${parisDateInput()}T00:00:00Z`);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.tournee.findUnique({ where: { date_zone: { date: today, zone: d.zone } } });
      if (existing) throw new Error("Une tournée existe déjà pour cette zone aujourd’hui. Utilisez l’attribution depuis la base de prospects pour répartir le travail.");
      const picked = await tx.prospect.findMany({
        where: { zone: d.zone, status: "NOUVEAU", assignedToId: null, tier: { gte: d.minTier } },
        orderBy: [{ tier: "desc" }, { reviewCount: "desc" }], take: d.size, select: { id: true },
      });
      if (!picked.length) throw new Error("Aucun prospect disponible pour ces critères.");
      const tournee = await tx.tournee.create({ data: { date: today, zone: d.zone, assignedToId: d.assignedToId } });
      for (const p of picked) {
        const claim = await tx.prospect.updateMany({ where: { id: p.id, status: "NOUVEAU", assignedToId: null }, data: { status: "EN_TOURNEE", tourneeId: tournee.id, assignedToId: d.assignedToId } });
        if (claim.count) await tx.salesTask.create({ data: { title: "Contacter le salon", assignedToId: d.assignedToId, prospectId: p.id, dueAt: parisDeadline(parisDateInput()) } });
      }
    });
  });
}

export async function assignProspects(fd: FormData) {
  await requireAdmin();
  return withErrorBanner(async () => {
    const ids = z.array(z.string().min(1)).min(1).max(100).parse(fd.getAll("prospectId"));
    const requestKey = z.uuid().parse(fd.get("requestKey"));
    const assignedToId = z.string().min(1).parse(fd.get("assignedToId"));
    const title = z.string().trim().min(1).max(200).parse(fd.get("title"));
    const dueAt = parisDeadline(z.string().parse(fd.get("dueAt")));
    await activeAssignee(assignedToId);
    await prisma.$transaction(async (tx) => {
      const leads = await tx.prospect.findMany({ where: { id: { in: ids }, status: { in: ["NOUVEAU", "EN_TOURNEE"] }, matchedSalonId: null } });
      if (leads.length !== new Set(ids).size) throw new Error("Certains prospects ne sont plus disponibles. Actualisez la liste.");
      await tx.prospect.updateMany({ where: { id: { in: ids } }, data: { assignedToId, tourneeId: null, status: "EN_TOURNEE" } });
      // Reassignment transfers existing open work rather than leaving it with a former owner.
      await tx.salesTask.updateMany({ where: { prospectId: { in: ids }, doneAt: null }, data: { assignedToId } });
      await tx.salesTask.createMany({ data: leads.map(p => ({ requestKey: `${requestKey}:${p.id}`, title, assignedToId, prospectId: p.id, dueAt })), skipDuplicates: true });
    });
  });
}

export async function releaseProspect(fd: FormData) {
  await requireAdmin();
  return withErrorBanner(async () => {
    const id = z.string().min(1).parse(fd.get("prospectId"));
    await prisma.$transaction(async tx => {
      const changed = await tx.prospect.updateMany({ where: { id, status: "EN_TOURNEE" }, data: { status: "NOUVEAU", tourneeId: null, assignedToId: null } });
      if (!changed.count) throw new Error("Ce prospect n’est plus attribué.");
      await tx.salesTask.updateMany({ where: { prospectId: id, doneAt: null }, data: { doneAt: new Date(), outcome: "Remis dans la base par l’administration." } });
    });
  });
}

export async function discardProspect(fd: FormData) {
  const user = await requireMember();
  return withErrorBanner(async () => {
    const id = z.string().min(1).parse(fd.get("prospectId"));
    await prisma.$transaction(async tx => {
      const changed = await tx.prospect.updateMany({ where: { id, ...prospectScope(user), status: { in: ["NOUVEAU", "EN_TOURNEE"] } }, data: { status: "ECARTE" } });
      if (!changed.count) throw new Error("Prospect inaccessible ou déjà traité.");
      await tx.salesTask.updateMany({ where: { prospectId: id, doneAt: null }, data: { doneAt: new Date(), outcome: "Prospect écarté." } });
    });
  });
}

export async function validateInstagram(fd: FormData) {
  const user = await requireMember();
  return withErrorBanner(async () => {
    const d = z.object({ prospectId: z.string().min(1), username: z.string().min(1) }).parse(Object.fromEntries(fd));
    const prospect = await prisma.prospect.findFirst({ where: { id: d.prospectId, ...prospectScope(user) } });
    if (!prospect) throw new Error("Prospect inaccessible.");
    const candidates = Array.isArray(prospect.igCandidates) ? prospect.igCandidates : [];
    const chosen = candidates.find(c => c && typeof c === "object" && "username" in c && c.username === d.username) as { username: string; followers?: number | null } | undefined;
    if (!chosen) throw new Error("Compte Instagram inconnu pour ce prospect.");
    await prisma.prospect.update({ where: { id: prospect.id }, data: { instagram: chosen.username, instagramFollowers: chosen.followers ?? null, igStatus: "CONFIRME", igCheckedAt: new Date(), tier: tierForProspect({ instagramFollowers: chosen.followers }) } });
  });
}

const SOURCE_TO_BOOKING_TOOL: Record<ProspectSource, BookingTool> = { PLANITY: "PLANITY", TREATWELL: "TREATWELL", BOOKSY: "BOOKSY", FRESHA: "FRESHA", GOOGLE: "NONE", INSTAGRAM: "NONE" };

export async function convertProspect(fd: FormData) {
  const user = await requireMember();
  return withErrorBanner(async () => {
    const id = z.string().min(1).parse(fd.get("prospectId"));
    await prisma.$transaction(async tx => {
      const prospect = await tx.prospect.findFirst({ where: { id, ...prospectScope(user) }, include: { tournee: true } });
      if (!prospect) throw new Error("Prospect inaccessible.");
      if (prospect.status === "CONVERTI") return;
      if (prospect.matchedSalonId || !["NOUVEAU", "EN_TOURNEE"].includes(prospect.status)) throw new Error("Ce prospect est déjà traité.");
      const claimed = await tx.prospect.updateMany({ where: { id, status: prospect.status, salonId: null }, data: { status: "CONVERTI" } });
      if (!claimed.count) throw new Error("Ce prospect vient d’être modifié. Actualisez la liste.");
      const salon = await tx.salon.create({ data: {
        name: prospect.name, slug: await uniqueSalonSlug(prospect.name), metier: prospect.metiers,
        arrondissement: prospect.postalCode, address: prospect.address, instagram: prospect.instagram,
        bookingTool: SOURCE_TO_BOOKING_TOOL[prospect.source], bookingUrl: ["GOOGLE", "INSTAGRAM"].includes(prospect.source) ? null : prospect.sourceUrl, rating: prospect.rating,
        source: "SCRAPE", sourceLabel: prospect.dualPlatformCheckedAt ? "Prospection Treatwell + Planity" : `Prospection ${prospect.source.toLowerCase()}`,
        notes: [prospect.treatwellUrl ? `Fiche Treatwell : ${prospect.treatwellUrl}` : null, prospect.planityUrl ? `Fiche Planity : ${prospect.planityUrl}` : null].filter(Boolean).join("\n") || null,
        assignedToId: prospect.assignedToId ?? prospect.tournee?.assignedToId ?? user.id,
      } });
      await tx.prospect.update({ where: { id }, data: { salonId: salon.id } });
      await tx.salesTask.updateMany({ where: { prospectId: id }, data: { salonId: salon.id } });
    });
    revalidatePath("/salons");
  });
}
