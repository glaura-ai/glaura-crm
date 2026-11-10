import { prisma } from "@/lib/db";
import { frenchDate } from "@/lib/crm-format";
import { canAccessInstagram } from "@/lib/access";
import Link from "next/link";
import { requireMember } from "@/lib/access";
import { getDashboard } from "@/lib/dashboard";
import { getSalonOwners } from "@/lib/salons";
import { TYPE_STYLE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { SalonType } from "@/generated/prisma/enums";

const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";
const TYPES: Array<{ type: SalonType; label: string }> = [
  { type: "A", label: "Catégorie A · prioritaire" },
  { type: "B", label: "Catégorie B · professionnel" },
  { type: "C", label: "Catégorie C · Instagram fort" },
  { type: "D", label: "Catégorie D · demande" },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = { user: await requireMember() };
  const viewer = session?.user ? { id: session.user.id, role: session.user.role } : undefined;
  const isAdmin = viewer?.role === "ADMIN";
  const selectedOwnerId = isAdmin ? sp.owner : viewer?.id;
  const [dashboard, owners] = await Promise.all([
    getDashboard(new Date(), selectedOwnerId),
    isAdmin ? getSalonOwners() : Promise.resolve([]),
  ]);
  const selectedOwner = owners.find((owner) => owner.id === selectedOwnerId);
  const ownerParam = isAdmin ? selectedOwnerId : undefined;
  const salonHref = (filters: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    if (ownerParam) qs.set("owner", ownerParam);
    for (const [key, value] of Object.entries(filters)) if (value) qs.set(key, value);
    const query = qs.toString();
    return query ? `/salons?${query}` : "/salons";
  };
  const dashboardHref = (ownerId?: string) => (ownerId ? `/dashboard?owner=${ownerId}` : "/dashboard");
  const taskScope = selectedOwnerId ? { assignedToId: selectedOwnerId } : {};
  const [openTasks, overdueCount, noOwnerCount, instagramCount] = await Promise.all([
    prisma.salesTask.findMany({ where: { ...taskScope, doneAt: null }, orderBy: { dueAt: "asc" }, take: 6, select: { id: true, title: true, dueAt: true, assignedTo: { select: { name: true, email: true } }, salon: { select: { name: true } }, prospect: { select: { name: true } } } }),
    prisma.salesTask.count({ where: { ...taskScope, doneAt: null, dueAt: { lt: new Date() } } }),
    isAdmin ? prisma.prospect.count({ where: { assignedToId: null, tourneeId: null, status: "NOUVEAU" } }) : Promise.resolve(0),
    session?.user && canAccessInstagram(session.user) ? prisma.instagramConversation.count({ where: { resolvedAt: null } }) : Promise.resolve(0),
  ]);
  const today = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-rose-500">
            {selectedOwner ? `Vue ${selectedOwner.name ?? selectedOwner.email}` : isAdmin ? "Vue globale admin" : "Ton plan du jour"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-900">Aujourd&apos;hui, {today}</h1>
        </div>
        <div className="text-sm text-slate-500">
          <span className="text-lg font-semibold text-emerald-600">{dashboard.doneToday}</span> action{dashboard.doneToday > 1 ? "s" : ""} faite{dashboard.doneToday > 1 ? "s" : ""}
        </div>
      </div>

      {isAdmin && owners.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          <Link
            href={dashboardHref()}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition",
              !selectedOwnerId ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            )}
          >
            Tous les commerciaux
          </Link>
          {owners.map((owner) => (
            <Link
              key={owner.id}
              href={dashboardHref(owner.id)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium transition",
                selectedOwnerId === owner.id ? "bg-rose-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              )}
            >
              {owner.name ?? owner.email}
            </Link>
          ))}
        </div>
      )}

      <section className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className={card}><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-950">Prochaines actions</h2><Link href="/taches" className="text-sm font-medium text-rose-700">Toutes les tâches →</Link></div><div className="divide-y divide-slate-100">{openTasks.map(task => <Link key={task.id} href="/taches" className="flex items-start justify-between gap-3 py-3"><div><p className="text-sm font-medium text-slate-900">{task.title}</p><p className="mt-1 text-xs text-slate-500">{task.salon?.name ?? task.prospect?.name ?? "Tâche interne"} · {task.assignedTo.name ?? task.assignedTo.email}</p></div><span className={`shrink-0 text-xs ${task.dueAt < new Date() ? "text-amber-700" : "text-slate-500"}`}>{frenchDate(task.dueAt)}</span></Link>)}{!openTasks.length && <p className="py-8 text-sm text-slate-500">Aucune tâche ouverte. Préparez vos prochaines actions depuis la base de prospects.</p>}</div></div>
        <div className="grid content-start gap-3"><Link href="/taches" className={card}><p className="text-sm text-slate-500">Tâches en retard</p><p className="mt-2 text-3xl font-semibold text-amber-700">{overdueCount}</p></Link>{isAdmin && <Link href="/prospection?owner=none" className={card}><p className="text-sm text-slate-500">Prospects à attribuer</p><p className="mt-2 text-3xl font-semibold text-slate-950">{noOwnerCount}</p></Link>}{session?.user && canAccessInstagram(session.user) && <Link href="/instagram" className={card}><p className="text-sm text-slate-500">Conversations Instagram à traiter</p><p className="mt-2 text-3xl font-semibold text-violet-700">{instagramCount}</p></Link>}</div>
      </section>
      <h2 className="mb-3 text-lg font-semibold text-slate-900">Vue d’ensemble des salons</h2>
      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <MetricCard dark label="Total" value={dashboard.totalSalons} href={salonHref()} />
        {TYPES.map(({ type, label }) => (
          <MetricCard key={type} label={label} value={dashboard.typeCounts[type]} href={salonHref({ type })} dotClass={TYPE_STYLE[type]} />
        ))}
        <MetricCard label="Signés" value={dashboard.statusCounts.SIGNE ?? 0} href={salonHref({ status: "SIGNE" })} valueClass="text-emerald-600" />
      </section>

    </div>
  );
}

function MetricCard({
  label,
  value,
  href,
  dark = false,
  dotClass,
  valueClass,
}: {
  label: string;
  value: number;
  href: string;
  dark?: boolean;
  dotClass?: string;
  valueClass?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "min-h-24 rounded-xl p-4 shadow-sm ring-1 transition hover:shadow-md",
        dark ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-900 ring-slate-200"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className={cn("text-xs font-semibold uppercase tracking-wide", dark ? "text-slate-300" : "text-slate-400")}>{label}</div>
        {dotClass && <span className={cn("h-2.5 w-2.5 rounded-full", dotClass)} />}
      </div>
      <div className={cn("mt-3 text-3xl font-semibold", valueClass)}>{value}</div>
    </Link>
  );
}
