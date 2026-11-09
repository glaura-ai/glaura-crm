import type { Prisma, SalonStatus } from "@/generated/prisma/client";
import { temperatureSchema } from "./qualification";
import { STATUS_ORDER } from "@/lib/labels";

type Params = Record<string, string | undefined>;
export function conversationWhere(sp: Params, now = new Date()): Prisma.InstagramConversationWhereInput {
  const AND: Prisma.InstagramConversationWhereInput[] = [];
  if (sp.filter === "unlinked") AND.push({ salonId: null });
  if (sp.filter === "unassigned") AND.push({ OR: [{ salonId: null }, { salon: { is: { assignedToId: null } } }] });
  if (sp.filter === "overdue") AND.push({ salon: { is: { OR: [
    { tasks: { some: { doneAt: null, dueAt: { lt: now } } } },
    { tasks: { none: { doneAt: null } }, nextActionAt: { lt: now } },
  ] } } });
  if (STATUS_ORDER.includes(sp.status as SalonStatus)) AND.push({ salon: { is: { status: sp.status as SalonStatus } } });
  if (temperatureSchema.safeParse(sp.temperature).success) AND.push({ qualification: sp.temperature, qualificationPending: false });
  if (sp.owner) AND.push({ salon: { is: { assignedToId: sp.owner } } });
  return {
    ...(sp.view === "done" ? { resolvedAt: { not: null } } : sp.view === "waiting" ? { resolvedAt: null, waitingAt: { not: null } } : sp.view === "all" ? {} : { resolvedAt: null, waitingAt: null }),
    ...(AND.length ? { AND } : {}),
  };
}

// Whitelist internal inbox parameters so links and action redirects preserve the view.
export function inboxHref(sp: Params, changes: Record<string, string | null> = {}) {
  const params = new URLSearchParams();
  for (const key of ["view", "filter", "status", "temperature", "owner", "page", "conversation", "q"]) {
    const value = key in changes ? changes[key] : sp[key];
    if (value) params.set(key, value);
  }
  return `/instagram${params.size ? `?${params}` : ""}`;
}

export function nextLeadAction(salon: { tasks: { title: string; dueAt: Date }[]; nextActionAt: Date | null }, now = new Date()) {
  const next = salon.tasks[0] ?? (salon.nextActionAt ? { title: "Relancer le salon", dueAt: salon.nextActionAt } : null);
  return next ? { ...next, overdue: next.dueAt < now } : null;
}

export const leadTrackingInclude = {
  assignedTo: { select: { name: true, email: true, active: true } },
  tasks: { where: { doneAt: null }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 1, select: { title: true, dueAt: true } },
} satisfies Prisma.SalonInclude;
