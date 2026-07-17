import { prisma } from "@/lib/db";
import { startOfDay } from "@/lib/dailyPriority";
import { ZONES } from "@/lib/prospection/zones";

export type ZoneAvailability = {
  slug: string;
  label: string;
  dept: string;
  available: number; // NOUVEAU prospects ready for a tournée
};

// Per-zone count of prospects available for a tournée, in ZONES order.
export async function getZoneAvailability(): Promise<ZoneAvailability[]> {
  const grouped = await prisma.prospect.groupBy({
    by: ["zone"],
    where: { status: "NOUVEAU", zone: { not: null } },
    _count: { _all: true },
  });
  const countByZone = new Map(grouped.map((g) => [g.zone as string, g._count._all]));
  return ZONES.map((zone) => ({
    slug: zone.slug,
    label: zone.label,
    dept: zone.dept,
    available: countByZone.get(zone.slug) ?? 0,
  }));
}

export type TourneeProspect = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  metiers: string[];
  source: string;
  sourceUrl: string;
  rating: number | null;
  reviewCount: number;
  instagram: string | null;
  status: string;
};

export type TourneeWithProspects = {
  id: string;
  date: Date;
  zone: string;
  assignedTo: { id: string; name: string | null; email: string | null } | null;
  prospects: TourneeProspect[];
};

// Today's tournées (all zones), most recent first, with their prospects.
export async function getTodaysTournees(today = new Date()): Promise<TourneeWithProspects[]> {
  const tournees = await prisma.tournee.findMany({
    where: { date: startOfDay(today) },
    orderBy: { createdAt: "desc" },
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
      prospects: {
        orderBy: { reviewCount: "desc" },
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          postalCode: true,
          metiers: true,
          source: true,
          sourceUrl: true,
          rating: true,
          reviewCount: true,
          instagram: true,
          status: true,
        },
      },
    },
  });
  return tournees;
}

export type ProspectionStats = {
  total: number;
  nouveau: number;
  enTournee: number;
  converti: number;
  dejaCrm: number;
};

export async function getProspectionStats(): Promise<ProspectionStats> {
  const grouped = await prisma.prospect.groupBy({ by: ["status"], _count: { _all: true } });
  const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
  const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
  return {
    total,
    nouveau: byStatus.get("NOUVEAU") ?? 0,
    enTournee: byStatus.get("EN_TOURNEE") ?? 0,
    converti: byStatus.get("CONVERTI") ?? 0,
    dejaCrm: byStatus.get("DEJA_CRM") ?? 0,
  };
}
