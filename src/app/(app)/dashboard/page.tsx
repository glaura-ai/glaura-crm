import Link from "next/link";
import { auth } from "@/auth";
import { getDashboard } from "@/lib/dashboard";
import { getSalonOwners } from "@/lib/salons";
import { ACTIVITY_LABEL, STATUS_LABEL, STATUS_STYLE, TYPE_STYLE } from "@/lib/labels";
import { cn, timeAgo } from "@/lib/utils";
import type { SalonStatus, SalonType } from "@/generated/prisma/enums";

const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";
const TYPES: Array<{ type: SalonType; label: string }> = [
  { type: "A", label: "Tier A · top" },
  { type: "B", label: "Tier B · pro" },
  { type: "C", label: "Tier C · IG fort" },
  { type: "D", label: "Tier D · demande" },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await auth();
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
  const today = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const maxFunnel = Math.max(...dashboard.funnel.map((s) => s.count), 1);

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

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <MetricCard dark label="Total" value={dashboard.totalSalons} href={salonHref()} />
        {TYPES.map(({ type, label }) => (
          <MetricCard key={type} label={label} value={dashboard.typeCounts[type]} href={salonHref({ type })} dotClass={TYPE_STYLE[type]} />
        ))}
        <MetricCard label="Signés" value={dashboard.statusCounts.SIGNE ?? 0} href={salonHref({ status: "SIGNE" })} valueClass="text-emerald-600" />
      </section>

      {dashboard.dailyPriorities.length > 0 && (
        <section className="mb-6">
          <ActionBucket
            accent="border-l-amber-400"
            count={dashboard.dailyPriorities.length}
            title="★ Priorité du jour"
            empty="Aucune priorité du jour."
            href={salonHref()}
            items={dashboard.dailyPriorities.map((s) => ({
              href: `/salons/${s.id}`,
              title: s.name,
              meta: [s.arrondissement, s.type ? `Type ${s.type}` : null, s.assignedTo?.name ?? s.assignedTo?.email].filter(Boolean).join(" · "),
            }))}
          />
        </section>
      )}

      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ActionBucket
          accent="border-l-indigo-500"
          count={dashboard.visitPriorities.length}
          title="Priorités à visiter"
          empty="Aucune visite prioritaire."
          href={salonHref({ status: "A_VISITER" })}
          items={dashboard.visitPriorities.map((s) => ({
            href: `/salons/${s.id}`,
            title: s.name,
            meta: [s.arrondissement, s.type ? `Type ${s.type}` : null, s.assignedTo?.name ?? s.assignedTo?.email].filter(Boolean).join(" · "),
          }))}
        />
        <ActionBucket
          accent="border-l-amber-500"
          count={dashboard.dueReminders.length}
          title="Relances dues"
          empty="Pas de relance due aujourd'hui."
          href={salonHref({ status: "A_RELANCER" })}
          items={dashboard.dueReminders.map((r) => ({
            href: `/salons/${r.salon.id}`,
            title: r.salon.name,
            meta: `${r.title} · ${new Date(r.dueAt).toLocaleString("fr-FR")}`,
          }))}
        />
        <ActionBucket
          accent="border-l-slate-500"
          count={dashboard.staleFollowups.length}
          title="À recontacter"
          empty="Personne à recontacter."
          href={salonHref({ status: "INTERESSE" })}
          items={dashboard.staleFollowups.map((s) => ({
            href: `/salons/${s.id}`,
            title: s.name,
            meta: `${STATUS_LABEL[s.status]}${s.lastContactedAt ? ` · dernier contact ${timeAgo(s.lastContactedAt)}` : ""}`,
          }))}
        />
      </section>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link href={salonHref({ status: "A_VISITER" })} className="inline-flex w-fit items-center rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800">
          Voir mes {dashboard.actionsDue} actions du jour →
        </Link>
        <Link href="/salons/new" className="inline-flex w-fit rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
          Ajouter un salon
        </Link>
      </div>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className={card}>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Cette semaine</h2>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-600">live</span>
          </div>
          <div className="text-3xl font-semibold text-slate-900">
            <span className="text-indigo-500">{dashboard.visitsThisWeek}</span>
            <span className="text-slate-300"> / 30</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">visites</p>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min((dashboard.visitsThisWeek / 30) * 100, 100)}%` }} />
          </div>
          <div className="mt-5 flex gap-5 text-sm">
            <span><strong className="text-slate-900">{dashboard.statusCounts.INTERESSE ?? 0}</strong> intéressés</span>
            <span><strong className="text-slate-900">{dashboard.statusCounts.SIGNE ?? 0}</strong> signés</span>
          </div>
        </div>

        <div className={cn(card, "lg:col-span-1")}>
          <h2 className="mb-5 text-sm font-semibold uppercase tracking-wide text-slate-400">Funnel de conversion</h2>
          <div className="flex h-48 items-end gap-3">
            {dashboard.funnel.map(({ status, count }) => (
              <FunnelBar key={status} status={status} count={count} max={maxFunnel} href={salonHref({ status })} />
            ))}
          </div>
        </div>

        <div className={card}>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Aujourd&apos;hui</h2>
            <span className="text-2xl font-semibold text-indigo-500">{dashboard.doneToday}</span>
          </div>
          {dashboard.todaysActions.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune action enregistrée.</p>
          ) : (
            <ul className="space-y-3">
              {dashboard.todaysActions.map((a) => (
                <li key={a.id} className="border-l-2 border-slate-100 pl-3">
                  <Link href={`/salons/${a.salon.id}`} className="text-sm font-medium text-slate-800 hover:text-rose-600">
                    {ACTIVITY_LABEL[a.type]} · {a.salon.name}
                  </Link>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span>{a.user?.name ?? a.user?.email ?? "Equipe"}</span>
                    <span>{timeAgo(a.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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

function ActionBucket({
  accent,
  count,
  title,
  empty,
  href,
  items,
}: {
  accent: string;
  count: number;
  title: string;
  empty: string;
  href: string;
  items: Array<{ href: string; title: string; meta: string }>;
}) {
  return (
    <div className={cn(card, "border-l-4", accent)}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="text-3xl font-semibold text-slate-900">{count}</div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        </div>
        <Link href={href} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50">
          Voir
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="block rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <div className="text-sm font-medium text-slate-800">{item.title}</div>
                <div className="truncate text-xs text-slate-400">{item.meta || "Sans détail"}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FunnelBar({ status, count, max, href }: { status: SalonStatus; count: number; max: number; href: string }) {
  const height = Math.max((count / max) * 100, count > 0 ? 18 : 8);
  return (
    <Link href={href} className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <div className="flex h-36 w-full items-end rounded-lg bg-slate-50 p-1">
        <div className={cn("w-full rounded-md", STATUS_STYLE[status])} style={{ height: `${height}%` }} />
      </div>
      <div className="text-center">
        <div className="text-lg font-semibold text-slate-900">{count}</div>
        <div className="truncate text-xs font-medium text-slate-500">{STATUS_LABEL[status]}</div>
      </div>
    </Link>
  );
}
