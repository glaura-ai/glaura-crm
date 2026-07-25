import { prisma } from "@/lib/db";
import { activeDailyPriorityDateFilter } from "@/lib/dailyPriority";
import { phoneSearchTerm } from "@/lib/phone";
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

// Stored phone numbers are unnormalized, so an ILIKE on the raw column misses
// most of them. Both sides are reduced to the French national form and compared
// as a substring, which lets a partial number — the last six digits, say —
// still find its salon.
//
// salon_phone_canonical() is the database-side twin of canonicalizePhone(); it
// is defined, and indexed, in the 20260725120000_salon_search_trgm_indexes
// migration. Calling the shared function (rather than inlining the CASE here)
// is what lets the planner use that expression index.
async function salonIdsMatchingPhone(term: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Salon"
    WHERE phone IS NOT NULL
      AND salon_phone_canonical(phone) LIKE ${`%${term}%`}
  `;
  return rows.map((r) => r.id);
}

export async function getSalons(f: SalonFilters, viewer?: ViewerScope) {
  const q = f.q?.trim();
  const ownerId = scopedOwnerId(f, viewer);
  const phoneTerm = q ? phoneSearchTerm(q) : null;
  const phoneMatchIds = phoneTerm ? await salonIdsMatchingPhone(phoneTerm) : [];
  return prisma.salon.findMany({
    where: {
      // Merged duplicates stay in the table but out of the pipeline.
      archivedAt: null,
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
              ...(phoneMatchIds.length ? [{ id: { in: phoneMatchIds } }] : []),
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
    where: {
      archivedAt: null,
      ...(viewer && viewer.role !== "ADMIN" ? { assignedToId: viewer.id } : {}),
    },
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
