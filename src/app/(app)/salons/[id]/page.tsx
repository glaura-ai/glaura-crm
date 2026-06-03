import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getSalon } from "@/lib/salons";
import { addReminder, changeStatus, completeReminder, logActivity, triggerOnboarding } from "@/lib/actions";
import {
  ACTIVITY_LABEL,
  BOOKING_LABEL,
  METIER_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_STYLE,
  TYPE_STYLE,
} from "@/lib/labels";
import { cn, timeAgo } from "@/lib/utils";

const ACT_TYPES = ["APPEL", "VISIO", "VISITE", "RELANCE", "EMAIL", "DEMO", "NOTE"] as const;
const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";
const field = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100";

export default async function SalonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const salon = await getSalon(id);
  if (!salon) notFound();

  const session = await auth();
  const me = session?.user;
  const isAdmin = me?.role === "ADMIN";
  const canTrigger = !!me && (isAdmin || salon.assignedToId === me.id) && (isAdmin || salon.status === "SIGNE");
  const latestJob = salon.onboardingJobs[0];

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/salons" className="text-sm text-slate-500 hover:text-slate-700">← Salons</Link>
        <Link href={`/salons/${id}/edit`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
          Modifier
        </Link>
      </div>

      <div className="mb-5 flex items-start gap-3">
        {salon.type && (
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold text-white", TYPE_STYLE[salon.type])}>{salon.type}</span>
        )}
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{salon.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {salon.metier.map((m) => (
              <span key={m} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{METIER_LABEL[m]}</span>
            ))}
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[salon.status])}>{STATUS_LABEL[salon.status]}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left: info + status + onboarding */}
        <div className="space-y-5">
          <div className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Informations</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Adresse" value={salon.address} />
              <Row label="Arrondissement" value={salon.arrondissement} />
              <Row label="Téléphone" value={salon.phone} />
              <Row label="Instagram" value={salon.instagram ? `@${salon.instagram}` : null} />
              <Row label="Réservation" value={salon.bookingTool !== "NONE" ? BOOKING_LABEL[salon.bookingTool] : null} />
              <Row label="Note" value={salon.rating ? `${salon.rating}/5` : null} />
              <Row label="Assigné à" value={salon.assignedTo?.name ?? salon.assignedTo?.email ?? null} />
            </dl>
          </div>

          <div className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Statut</h2>
            <form action={changeStatus.bind(null, id)} className="flex gap-2">
              <select name="status" defaultValue={salon.status} className={field}>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">OK</button>
            </form>
          </div>

          <div className={card}>
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Préparer le compte</h2>
            <p className="mb-3 text-xs text-slate-500">Crée un compte Glaura (désactivé) via le moteur d&apos;onboarding.</p>
            {latestJob ? (
              <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
                <div className="font-medium text-slate-700">Dernier job : {latestJob.status}</div>
                {latestJob.loginEmail && <div className="text-slate-500">{latestJob.loginEmail}</div>}
                {latestJob.serviceCount != null && (
                  <div className="text-xs text-slate-400">{latestJob.serviceCount} services · {latestJob.agentCount ?? 0} agents · {latestJob.videoCount ?? 0} vidéos</div>
                )}
              </div>
            ) : null}
            <form action={triggerOnboarding.bind(null, id)}>
              <button
                disabled={!canTrigger}
                className="w-full rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                Préparer le compte
              </button>
            </form>
            {!canTrigger && (
              <p className="mt-2 text-xs text-slate-400">
                {salon.status !== "SIGNE" ? "Disponible une fois le salon Signé." : "Réservé au commercial assigné ou à un admin."}
              </p>
            )}
          </div>
        </div>

        {/* Middle: activity */}
        <div className="space-y-5 lg:col-span-1">
          <div className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Nouvelle activité</h2>
            <form action={logActivity.bind(null, id)} className="space-y-2">
              <select name="type" className={field} defaultValue="APPEL">
                {ACT_TYPES.map((t) => (
                  <option key={t} value={t}>{ACTIVITY_LABEL[t]}</option>
                ))}
              </select>
              <textarea name="notes" rows={2} className={field} placeholder="Notes…" />
              <button className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">Enregistrer</button>
            </form>
          </div>

          <div className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Historique</h2>
            {salon.activities.length === 0 ? (
              <p className="text-sm text-slate-400">Aucune activité.</p>
            ) : (
              <ul className="space-y-3">
                {salon.activities.map((a) => (
                  <li key={a.id} className="border-l-2 border-slate-100 pl-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">{ACTIVITY_LABEL[a.type]}</span>
                      <span className="text-xs text-slate-400">{timeAgo(a.createdAt)}</span>
                    </div>
                    {a.notes && <p className="text-sm text-slate-500">{a.notes}</p>}
                    {a.user?.name && <p className="text-xs text-slate-400">{a.user.name}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: reminders */}
        <div className="space-y-5">
          <div className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Rappel / Relance</h2>
            <form action={addReminder.bind(null, id)} className="space-y-2">
              <input name="title" className={field} placeholder="Relancer pour la démo…" required />
              <input name="dueAt" type="datetime-local" className={field} required />
              <button className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">Ajouter</button>
            </form>
            <ul className="mt-4 space-y-2">
              {salon.reminders.map((r) => (
                <li key={r.id} className={cn("flex items-center justify-between rounded-lg p-2 text-sm", r.done ? "bg-slate-50 text-slate-400 line-through" : "bg-amber-50")}>
                  <div>
                    <div className={cn(!r.done && "font-medium text-slate-700")}>{r.title}</div>
                    <div className="text-xs text-slate-400">{new Date(r.dueAt).toLocaleString("fr-FR")}</div>
                  </div>
                  {!r.done && (
                    <form action={completeReminder.bind(null, r.id, id)}>
                      <button className="rounded-md px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50">✓</button>
                    </form>
                  )}
                </li>
              ))}
              {salon.reminders.length === 0 && <li className="text-sm text-slate-400">Aucun rappel.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-700">{value ?? "—"}</dd>
    </div>
  );
}
