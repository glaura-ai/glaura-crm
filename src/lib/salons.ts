import { prisma } from "@/lib/db";
import type { Metier, SalonStatus, SalonType } from "@/generated/prisma/enums";

export type SalonFilters = {
  status?: string;
  metier?: string;
  type?: string;
  arr?: string;
  q?: string;
};

export async function getSalons(f: SalonFilters) {
  const q = f.q?.trim();
  return prisma.salon.findMany({
    where: {
      ...(f.status ? { status: f.status as SalonStatus } : {}),
      ...(f.metier ? { metier: { has: f.metier as Metier } } : {}),
      ...(f.type ? { type: f.type as SalonType } : {}),
      ...(f.arr ? { arrondissement: f.arr } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { instagram: { contains: q, mode: "insensitive" as const } },
              { address: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: { assignedTo: { select: { name: true, email: true } } },
  });
}

export type SalonListItem = Awaited<ReturnType<typeof getSalons>>[number];

export async function getSalon(id: string) {
  return prisma.salon.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { name: true, email: true } },
      activities: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      reminders: { orderBy: [{ done: "asc" }, { dueAt: "asc" }] },
      onboardingJobs: { orderBy: { createdAt: "desc" } },
    },
  });
}

export type SalonDetail = NonNullable<Awaited<ReturnType<typeof getSalon>>>;

export async function getStatusCounts(): Promise<Record<string, number>> {
  const rows = await prisma.salon.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}
