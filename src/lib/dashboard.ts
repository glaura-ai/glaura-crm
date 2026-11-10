import { prisma } from "@/lib/db";
import { endOfDay, startOfDay } from "@/lib/dailyPriority";
import type { SalonType } from "@/generated/prisma/enums";

const TYPE_ORDER: SalonType[] = ["A", "B", "C", "D"];

export async function getDashboard(today = new Date(), ownerId?: string) {
  const salonScope = { archivedAt: null, ...(ownerId ? { assignedToId: ownerId } : {}) };
  const [totalSalons, typeRows, statusRows, doneToday] = await Promise.all([
    prisma.salon.count({ where: salonScope }),
    prisma.salon.groupBy({ by: ["type"], where: { ...salonScope, type: { not: null } }, _count: { _all: true } }),
    prisma.salon.groupBy({ by: ["status"], where: salonScope, _count: { _all: true } }),
    prisma.activity.count({ where: { ...(ownerId ? { userId: ownerId } : {}), createdAt: { gte: startOfDay(today), lte: endOfDay(today) } } }),
  ]);
  const typeCounts = Object.fromEntries(typeRows.flatMap(r => r.type ? [[r.type, r._count._all]] : []));
  return {
    totalSalons,
    typeCounts: Object.fromEntries(TYPE_ORDER.map(type => [type, typeCounts[type] ?? 0])) as Record<SalonType, number>,
    statusCounts: Object.fromEntries(statusRows.map(r => [r.status, r._count._all])),
    doneToday,
  };
}
