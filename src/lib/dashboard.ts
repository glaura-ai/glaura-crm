import { prisma } from "@/lib/db";
import type { SalonStatus, SalonType } from "@/generated/prisma/enums";

const TYPE_ORDER: SalonType[] = ["A", "B", "C", "D"];
const FUNNEL_STATUSES: SalonStatus[] = ["A_VISITER", "VISITE_FAITE", "INTERESSE", "SIGNE"];

function startOfDay(d: Date): Date {
  const v = new Date(d);
  v.setHours(0, 0, 0, 0);
  return v;
}

function endOfDay(d: Date): Date {
  const v = new Date(d);
  v.setHours(23, 59, 59, 999);
  return v;
}

function startOfWeek(d: Date): Date {
  const v = startOfDay(d);
  const day = v.getDay();
  v.setDate(v.getDate() + (day === 0 ? -6 : 1 - day));
  return v;
}

export async function getDashboard(today = new Date(), ownerId?: string) {
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);
  const weekStart = startOfWeek(today);
  const salonScope = ownerId ? { assignedToId: ownerId } : {};
  const activityScope = ownerId ? { userId: ownerId } : {};

  const [
    totalSalons,
    typeRows,
    statusRows,
    visitsThisWeek,
    doneToday,
    visitPriorities,
    dueReminders,
    staleFollowups,
    todaysActions,
  ] = await Promise.all([
    prisma.salon.count({ where: salonScope }),
    prisma.salon.groupBy({ by: ["type"], where: { ...salonScope, type: { not: null } }, _count: { _all: true } }),
    prisma.salon.groupBy({ by: ["status"], where: salonScope, _count: { _all: true } }),
    prisma.activity.count({ where: { ...activityScope, type: "VISITE", createdAt: { gte: weekStart, lte: dayEnd } } }),
    prisma.activity.count({ where: { ...activityScope, createdAt: { gte: dayStart, lte: dayEnd } } }),
    prisma.salon.findMany({
      where: { ...salonScope, status: "A_VISITER" },
      orderBy: [{ type: "asc" }, { rating: "desc" }, { updatedAt: "asc" }],
      take: 5,
      include: { assignedTo: { select: { name: true, email: true } } },
    }),
    prisma.reminder.findMany({
      where: { ...(ownerId ? { userId: ownerId } : {}), done: false, dueAt: { lte: dayEnd } },
      orderBy: { dueAt: "asc" },
      take: 5,
      include: { salon: { select: { id: true, name: true, status: true, type: true } } },
    }),
    prisma.salon.findMany({
      where: {
        ...salonScope,
        status: { in: ["INTERESSE", "VISITE_FAITE", "A_RELANCER"] },
        OR: [{ nextActionAt: { lte: dayEnd } }, { lastContactedAt: { lt: new Date(dayStart.getTime() - 7 * 864e5) } }],
      },
      orderBy: [{ nextActionAt: "asc" }, { lastContactedAt: "asc" }],
      take: 5,
      include: { assignedTo: { select: { name: true, email: true } } },
    }),
    prisma.activity.findMany({
      where: { ...activityScope, createdAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        salon: { select: { id: true, name: true, status: true } },
        user: { select: { name: true, email: true } },
      },
    }),
  ]);

  const typeCounts = Object.fromEntries(typeRows.flatMap((r) => (r.type ? [[r.type, r._count._all]] : [])));
  const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, r._count._all]));
  const actionsDue = visitPriorities.length + dueReminders.length + staleFollowups.length;

  return {
    totalSalons,
    typeCounts: Object.fromEntries(TYPE_ORDER.map((type) => [type, typeCounts[type] ?? 0])) as Record<SalonType, number>,
    statusCounts,
    visitsThisWeek,
    doneToday,
    actionsDue,
    visitPriorities,
    dueReminders,
    staleFollowups,
    todaysActions,
    funnel: FUNNEL_STATUSES.map((status) => ({ status, count: statusCounts[status] ?? 0 })),
  };
}
