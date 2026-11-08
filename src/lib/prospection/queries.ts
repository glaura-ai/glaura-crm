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

export type IgCandidateJson = {
  username: string;
  fullName: string | null;
  followers: number | null;
  score: number;
  signals: string[];
};

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
  instagramFollowers: number | null;
  igStatus: string;
  igCandidates: unknown;
  tier: number;
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
export async function getTodaysTournees(today = new Date(), ownerId?: string): Promise<TourneeWithProspects[]> {
  const tournees = await prisma.tournee.findMany({
    where: { ...(ownerId ? { assignedToId: ownerId } : {}), OR: [{ date: startOfDay(today) }, { prospects: { some: { status: "EN_TOURNEE", ...(ownerId ? { OR: [{ assignedToId: ownerId }, { assignedToId: null }] } : {}) } } }] },
    orderBy: { createdAt: "desc" },
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
      prospects: {
        where: ownerId ? { OR: [{ assignedToId: ownerId }, { assignedToId: null }] } : {},
        orderBy: [{ tier: "desc" }, { reviewCount: "desc" }],
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
          instagramFollowers: true,
          igStatus: true,
          igCandidates: true,
          tier: true,
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

export const PROSPECT_STATUS_LABEL: Record<string, string> = {
  NOUVEAU: "Disponible", EN_TOURNEE: "Attribué", CONVERTI: "Ajouté aux salons", ECARTE: "Écarté", DEJA_CRM: "Déjà dans le CRM",
};

export async function getProspectPool(user: { id: string; role?: string }, filters: Record<string, string | undefined>) {
  const { prospectScope } = await import("@/lib/access");
  const validStatuses = Object.keys(PROSPECT_STATUS_LABEL);
  const page = Math.max(1, Math.min(100000, Number.parseInt(filters.page ?? "", 10) || 1));
  const where: import("@/generated/prisma/client").Prisma.ProspectWhereInput = {
    AND: [prospectScope(user), ...(filters.owner && filters.owner !== "none" && user.role === "ADMIN" ? [{ OR: [{ assignedToId: filters.owner }, { assignedToId: null, tournee: { assignedToId: filters.owner } }] }] : [])],
    ...(filters.status && validStatuses.includes(filters.status) ? { status: filters.status as import("@/generated/prisma/enums").ProspectStatus } : {}),
    ...(filters.zone ? { zone: filters.zone } : {}),
    ...(filters.platform === "both" ? { treatwellUrl: { not: null }, planityUrl: { not: null }, dualPlatformCheckedAt: { not: null } } : {}),
    ...(filters.platform === "treatwell" ? { treatwellUrl: { not: null } } : {}),
    ...(filters.platform === "planity" ? { planityUrl: { not: null } } : {}),
    ...(filters.ig === "pending" ? { igStatus: "A_VALIDER" } : {}),
    ...(filters.ig === "missing" ? { instagram: null } : {}),
    ...(filters.owner === "none" && user.role === "ADMIN" ? { assignedToId: null, tourneeId: null } : {}),
    ...(filters.q?.trim() ? { OR: ["name", "city", "address", "instagram"].map(key => ({ [key]: { contains: filters.q!.trim().slice(0, 200), mode: "insensitive" } })) } : {}),
  };
  const [total, available, assigned, rows] = await Promise.all([
    prisma.prospect.count({ where }),
    prisma.prospect.count({ where: { ...prospectScope(user), status: "NOUVEAU" } }),
    prisma.prospect.count({ where: { ...prospectScope(user), status: "EN_TOURNEE" } }),
    prisma.prospect.findMany({ where, orderBy: [{ tier: "desc" }, { updatedAt: "desc" }, { id: "asc" }], skip: (page - 1) * 50, take: 50,
      include: { assignedTo: { select: { id: true, name: true, email: true } }, tournee: { select: { assignedTo: { select: { id: true, name: true, email: true } } } }, _count: { select: { tasks: { where: { doneAt: null } } } } },
    }),
  ]);
  return { total, available, assigned, rows, page, pages: Math.max(1, Math.ceil(total / 50)) };
}
