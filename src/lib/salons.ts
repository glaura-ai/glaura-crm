import { prisma } from "@/lib/db";
import { activeDailyPriorityDateFilter } from "@/lib/dailyPriority";
import type { LeadSource, Metier, SalonStatus, SalonType } from "@/generated/prisma/enums";

export type ViewerScope = {
  id: string;
  role?: string | null;
};

export type SalonFilters = {
  status?: string;
  metier?: string;
  type?: string;
  owner?: string;
  arr?: string;
  source?: string; // "SCRAPE" → salons converted from prospecting
  prio?: string; // "today" → active daily priorities, including carried-over pins
  q?: string;
};

function scopedOwnerId(f: SalonFilters, viewer?: ViewerScope): string | undefined {
  if (!viewer) return f.owner;
  return viewer.role === "ADMIN" ? f.owner : viewer.id;
}

export async function getSalons(f: SalonFilters, viewer?: ViewerScope) {
  const q = f.q?.trim();
  const ownerId = scopedOwnerId(f, viewer);
  return prisma.salon.findMany({
    where: {
      ...(f.status ? { status: f.status as SalonStatus } : {}),
      ...(f.metier ? { metier: { has: f.metier as Metier } } : {}),
      ...(f.type ? { type: f.type as SalonType } : {}),
      ...(ownerId ? { assignedToId: ownerId } : {}),
      ...(f.arr ? { arrondissement: f.arr } : {}),
      ...(f.source ? { source: f.source as LeadSource } : {}),
      ...(f.prio === "today" ? { priorityDate: activeDailyPriorityDateFilter() } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { contactName: { contains: q, mode: "insensitive" as const } },
              { contactEmail: { contains: q, mode: "insensitive" as const } },
              { instagram: { contains: q, mode: "insensitive" as const } },
              { address: { contains: q, mode: "insensitive" as const } },
              { notes: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: { assignedTo: { select: { id: true, name: true, email: true } } },
  });
}

export type SalonListItem = Awaited<ReturnType<typeof getSalons>>[number];

export async function getSalon(id: string, viewer?: ViewerScope) {
  return prisma.salon.findFirst({
    where: {
      id,
      ...(viewer && viewer.role !== "ADMIN" ? { assignedToId: viewer.id } : {}),
    },
    include: {
      assignedTo: { select: { name: true, email: true } },
      activities: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      reminders: { orderBy: [{ done: "asc" }, { dueAt: "asc" }] },
      onboardingJobs: { orderBy: { createdAt: "desc" } },
      emailJobs: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
}

export type SalonDetail = NonNullable<Awaited<ReturnType<typeof getSalon>>>;

export async function getStatusCounts(viewer?: ViewerScope): Promise<Record<string, number>> {
  const rows = await prisma.salon.groupBy({
    by: ["status"],
    where: viewer && viewer.role !== "ADMIN" ? { assignedToId: viewer.id } : undefined,
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

export async function getSalonOwners() {
  return prisma.user.findMany({
    where: { assignedSalons: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
}

// Everyone a salon can be (re)assigned to — used by the assignee pickers.
// Excludes deactivated accounts (ex-employees, dev/test) so they no longer
// appear as options; their historical salon assignments are untouched.
export async function getAssignableUsers() {
  return prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
}
