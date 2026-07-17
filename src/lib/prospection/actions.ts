"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { startOfDay } from "@/lib/dailyPriority";
import { uniqueSalonSlug } from "@/lib/slugs";
import { ZONE_BY_SLUG } from "@/lib/prospection/zones";
import type { BookingTool, Metier, ProspectSource } from "@/generated/prisma/enums";

async function requireUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Non authentifié");
  return user;
}

// Expected failures (duplicate tournée, already-in-CRM…) surface as the
// ?error= banner on /prospection instead of a full-page error boundary.
async function withErrorBanner(work: () => Promise<void>): Promise<never> {
  let error: string | null = null;
  try {
    await work();
  } catch (e) {
    error = e instanceof Error ? e.message : "Erreur inattendue";
  }
  revalidatePath("/prospection");
  redirect(error ? `/prospection?error=${encodeURIComponent(error)}` : "/prospection");
}

const generateSchema = z.object({
  zone: z.string().min(1),
  assignedToId: z.string().optional(),
  size: z.coerce.number().int().min(5).max(30).default(25),
});

// Create today's tournée for a zone: pick the top-N available prospects
// (most reviews first — already filtered to ≥50 at sweep time).
export async function generateTournee(fd: FormData) {
  await requireUser();
  return withErrorBanner(async () => {
    const d = generateSchema.parse({
      zone: fd.get("zone"),
      assignedToId: fd.get("assignedToId")?.toString() || undefined,
      size: fd.get("size") || undefined,
    });
    if (!ZONE_BY_SLUG.has(d.zone)) throw new Error(`Zone inconnue: ${d.zone}`);

    const today = startOfDay();
    const existing = await prisma.tournee.findUnique({ where: { date_zone: { date: today, zone: d.zone } } });
    if (existing) throw new Error("Une tournée existe déjà aujourd'hui pour cette zone.");

    const picked = await prisma.prospect.findMany({
      where: { zone: d.zone, status: "NOUVEAU" },
      orderBy: { reviewCount: "desc" },
      take: d.size,
      select: { id: true },
    });
    if (picked.length === 0) throw new Error("Aucun prospect disponible dans cette zone — lance un sweep d'abord.");

    await prisma.$transaction(async (tx) => {
      const tournee = await tx.tournee.create({
        data: { date: today, zone: d.zone, assignedToId: d.assignedToId ?? null },
      });
      // status filter: a prospect converted/discarded since the pick above
      // must not be dragged back into the tournée.
      await tx.prospect.updateMany({
        where: { id: { in: picked.map((p) => p.id) }, status: "NOUVEAU" },
        data: { status: "EN_TOURNEE", tourneeId: tournee.id },
      });
    });
  });
}

// Put a prospect back into the pool (wrong pick, salon closed that day, …).
export async function releaseProspect(fd: FormData) {
  await requireUser();
  return withErrorBanner(async () => {
    const id = z.string().min(1).parse(fd.get("prospectId"));
    await prisma.prospect.updateMany({
      where: { id, status: "EN_TOURNEE" },
      data: { status: "NOUVEAU", tourneeId: null },
    });
  });
}

// Definitively discard a prospect (not a fit, closed down, duplicate…).
export async function discardProspect(fd: FormData) {
  await requireUser();
  return withErrorBanner(async () => {
    const id = z.string().min(1).parse(fd.get("prospectId"));
    await prisma.prospect.updateMany({
      where: { id, status: { in: ["NOUVEAU", "EN_TOURNEE"] } },
      data: { status: "ECARTE" },
    });
  });
}

const SOURCE_TO_BOOKING_TOOL: Record<ProspectSource, BookingTool> = {
  PLANITY: "PLANITY",
  TREATWELL: "TREATWELL",
  BOOKSY: "BOOKSY",
  FRESHA: "FRESHA",
};

// Promote a prospect to a Salon lead (status "À visiter") after a visit/contact.
export async function convertProspect(fd: FormData) {
  const me = await requireUser();
  return withErrorBanner(async () => {
    const id = z.string().min(1).parse(fd.get("prospectId"));

    const prospect = await prisma.prospect.findUniqueOrThrow({
      where: { id },
      include: { tournee: { select: { assignedToId: true } } },
    });
    if (prospect.status === "CONVERTI") return;
    if (prospect.matchedSalonId) throw new Error("Ce salon est déjà dans le CRM.");

    // Atomic claim: only one concurrent submit can flip the status, the
    // loser sees count 0 and stops — no duplicate Salon rows.
    const claimed = await prisma.prospect.updateMany({
      where: { id, status: { not: "CONVERTI" }, salonId: null },
      data: { status: "CONVERTI" },
    });
    if (claimed.count === 0) return;

    try {
      const slug = await uniqueSalonSlug(prospect.name);
      const salon = await prisma.salon.create({
        data: {
          name: prospect.name,
          slug,
          metier: prospect.metiers as Metier[],
          arrondissement: prospect.postalCode,
          address: prospect.address,
          instagram: prospect.instagram,
          bookingTool: SOURCE_TO_BOOKING_TOOL[prospect.source],
          bookingUrl: prospect.sourceUrl,
          rating: prospect.rating,
          status: "A_VISITER",
          source: "SCRAPE",
          sourceLabel: `Prospection ${prospect.source.toLowerCase()}`,
          notes: `Découvert via prospection (${prospect.source.toLowerCase()}, ${prospect.reviewCount} avis).`,
          assignedToId: prospect.tournee?.assignedToId ?? me.id,
        },
      });
      await prisma.prospect.update({ where: { id }, data: { salonId: salon.id } });
    } catch (e) {
      // Salon creation failed — release the claim so the prospect stays usable.
      await prisma.prospect.update({ where: { id }, data: { status: prospect.status } });
      throw e;
    }

    revalidatePath("/salons");
  });
}
