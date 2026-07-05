import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOnboardingMonitor } from "@/lib/onboarding-monitoring";
import { cn } from "@/lib/utils";

const card = "rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200";
const statusStyle = {
  QUEUED: "bg-amber-50 text-amber-800 ring-amber-200",
  PROCESSING: "bg-sky-50 text-sky-800 ring-sky-200",
  DONE: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  FAILED: "bg-rose-50 text-rose-800 ring-rose-200",
  ALREADY_ONBOARDED: "bg-violet-50 text-violet-800 ring-violet-200",
} as const;
const statusLabel = {
  QUEUED: "En file",
  PROCESSING: "En cours",
  DONE: "Termine",
  FAILED: "Echec",
  ALREADY_ONBOARDED: "Deja pret",
} as const;

export default async function OnboardingMonitorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/dashboard");

  const sp = await searchParams;
  const monitor = await getOnboardingMonitor(sp.job);
  const selected = monitor.selectedJob;
  const events = selected?.events.slice().reverse() ?? [];

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-rose-500">Monitoring onboarding</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-900">Performance Claude</h1>
        </div>
        <Link href="/salons" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
          Salons
        </Link>
      </div>

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Jobs 30j" value={monitor.metrics.total30d} />
        <Metric label="Succes" value={`${monitor.metrics.successRate30d}%`} tone="text-emerald-600" />
        <Metric label="Echecs" value={monitor.metrics.failed30d} tone="text-rose-600" />
        <Metric label="En cours" value={monitor.metrics.processing30d} tone="text-sky-600" />
        <Metric label="p50" value={formatDuration(monitor.metrics.p50DurationMs)} />
        <Metric label="p95" value={formatDuration(monitor.metrics.p95DurationMs)} />
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
        <div className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Derniers jobs</h2>
            <span className="text-xs text-slate-400">{monitor.jobs.length} affiches</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full table-fixed divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="w-[28%] px-3 py-2">Salon</th>
                  <th className="w-[14%] px-3 py-2">Statut</th>
                  <th className="w-[11%] px-3 py-2">Duree</th>
                  <th className="w-[15%] px-3 py-2">Sortie</th>
                  <th className="w-[12%] px-3 py-2">Items</th>
                  <th className="w-[20%] px-3 py-2">Lance par</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {monitor.jobs.map((job) => (
                  <tr key={job.id} className={cn("align-top hover:bg-slate-50", selected?.id === job.id && "bg-rose-50/50")}>
                    <td className="px-3 py-3">
                      <Link href={`/onboarding?job=${job.id}`} className="font-medium text-slate-900 hover:text-rose-600">
                        {job.salon.name}
                      </Link>
                      <div className="mt-1 text-xs text-slate-400">{new Date(job.createdAt).toLocaleString("fr-FR")}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1", statusStyle[job.status])}>{statusLabel[job.status]}</span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{formatDuration(job.durationMs)}</td>
                    <td className="px-3 py-3 text-slate-600">
                      <div>{job.exitCode == null ? "-" : `code ${job.exitCode}`}</div>
                      <div className="text-xs text-slate-400">{job.eventCount} events</div>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {job.serviceCount ?? 0} / {job.agentCount ?? 0}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      <div className="truncate">{job.requestedBy?.name ?? job.requestedBy?.email ?? "-"}</div>
                      <div className="truncate text-xs text-slate-400">{job.salon.assignedTo?.name ?? job.salon.assignedTo?.email ?? "Non assigne"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={card}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Trace du job</h2>
              {selected && (
                <Link href={`/salons/${selected.salon.id}`} className="mt-1 block text-base font-semibold text-slate-900 hover:text-rose-600">
                  {selected.salon.name}
                </Link>
              )}
            </div>
            {selected && <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1", statusStyle[selected.status])}>{statusLabel[selected.status]}</span>}
          </div>

          {!selected ? (
            <p className="text-sm text-slate-400">Aucun job onboarding.</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-slate-400">Aucun evenement persiste pour ce job.</p>
          ) : (
            <ol className="max-h-[720px] space-y-2 overflow-y-auto pr-1">
              {events.map((event) => (
                <li key={event.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="mb-1 flex items-center justify-between gap-2 text-slate-400">
                    <span className="font-mono">#{event.sequence} {event.stream}{event.type ? ` / ${event.type}` : ""}</span>
                    <span>{new Date(event.createdAt).toLocaleTimeString("fr-FR")}</span>
                  </div>
                  {event.text ? (
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-5 text-slate-700">{event.text}</pre>
                  ) : (
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-slate-500">{JSON.stringify(event.data, null, 2)}</pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone = "text-slate-900" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn("mt-2 text-2xl font-semibold", tone)}>{value}</div>
    </div>
  );
}

function formatDuration(ms: number | null | undefined) {
  if (ms == null) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}
