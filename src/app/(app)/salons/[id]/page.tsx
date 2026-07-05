import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmailFollowUpForm } from "@/components/EmailFollowUpForm";
import { SalonEditModal } from "@/components/SalonEditModal";
import { getSalon, getAssignableUsers } from "@/lib/salons";
import { addReminder, changeStatus, completeReminder, logActivity, queueFollowUpEmail, setDailyPriority, triggerOnboarding, updateSalon } from "@/lib/actions";
import { isDailyPriorityActive } from "@/lib/dailyPriority";
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
const card = "rounded-xl border border-slate-300 bg-white p-5 shadow-sm";
const field = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100";
const textareaField = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100";
const onboardingStatusLabel = {
  QUEUED: "En attente",
  PROCESSING: "En cours",
  DONE: "Compte préparé",
  FAILED: "Échec",
  ALREADY_ONBOARDED: "Déjà préparé",
} as const;
const onboardingStatusStyle = {
  QUEUED: "bg-amber-50 text-amber-800 ring-amber-200",
  PROCESSING: "bg-sky-50 text-sky-800 ring-sky-200",
  DONE: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  FAILED: "bg-rose-50 text-rose-800 ring-rose-200",
  ALREADY_ONBOARDED: "bg-violet-50 text-violet-800 ring-violet-200",
} as const;
const emailStatusLabel = {
  QUEUED: "En file",
  SENDING: "Envoi",
  SENT: "Envoyé",
  FAILED: "Échec",
} as const;
const emailStatusStyle = {
  QUEUED: "bg-amber-50 text-amber-800 ring-amber-200",
  SENDING: "bg-sky-50 text-sky-800 ring-sky-200",
  SENT: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  FAILED: "bg-rose-50 text-rose-800 ring-rose-200",
} as const;

export default async function SalonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const me = session?.user;
  const isAdmin = me?.role === "ADMIN";
  const [salon, assignableUsers] = await Promise.all([
    getSalon(id, me ? { id: me.id, role: me.role } : undefined),
    isAdmin ? getAssignableUsers() : Promise.resolve([]),
  ]);
  if (!salon) notFound();

  const priorityActive = isDailyPriorityActive(salon.priorityDate);
  const hasBookingUrl = !!salon.bookingUrl;
  const latestJob = salon.onboardingJobs[0];
  const onboardingBusy = latestJob?.status === "QUEUED" || latestJob?.status === "PROCESSING";
  const canTrigger = !!me && hasBookingUrl && !onboardingBusy && (isAdmin || salon.assignedToId === me.id) && (isAdmin || salon.status === "SIGNE");
  const visibleActivities = salon.activities.filter((activity) => activity.type !== "EMAIL");
  const editSalon = {
    name: salon.name,
    metier: salon.metier,
    type: salon.type,
    status: salon.status,
    arrondissement: salon.arrondissement,
    phone: salon.phone,
    contactName: salon.contactName,
    contactEmail: salon.contactEmail,
    address: salon.address,
    lat: salon.lat,
    lng: salon.lng,
    instagram: salon.instagram,
    bookingTool: salon.bookingTool,
    bookingUrl: salon.bookingUrl,
    notes: salon.notes,
    assignedToId: salon.assignedToId,
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      {onboardingBusy && <AutoRefresh intervalMs={5000} />}
      <div className="mb-4 flex items-center justify-between">
        <Link href="/salons" className="text-sm text-slate-500 hover:text-slate-700">← Salons</Link>
        <div className="flex items-center gap-2">
          <form action={setDailyPriority.bind(null, id)}>
            <button
              type="submit"
              title={priorityActive ? "Retirer la priorité du jour" : "Marquer comme priorité du jour"}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                priorityActive
                  ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {priorityActive ? "★ Priorité du jour" : "☆ Priorité du jour"}
            </button>
          </form>
          <Link href={`/salons/${id}/edit`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Modifier
          </Link>
        </div>
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
          <SalonEditModal action={updateSalon.bind(null, id)} salon={editSalon} isAdmin={isAdmin} assignableUsers={assignableUsers} priorityActive={priorityActive}>
            <div className={cn(card, "cursor-pointer transition hover:border-rose-300 hover:shadow-md")}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">Informations</h2>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">Modifier</span>
              </div>
              <dl className="space-y-2 text-sm">
                <Row label="Adresse" value={salon.address} />
                <Row label="Arrondissement" value={salon.arrondissement} />
                <Row label="Contact" value={salon.contactName} />
                <Row label="Email" value={salon.contactEmail} />
                <Row label="Téléphone" value={salon.phone} />
                <Row
                  label="Instagram"
                  value={
                    salon.instagram ? (
                      <a
                        href={`https://www.instagram.com/${salon.instagram}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-rose-600 hover:text-rose-700"
                      >
                        @{salon.instagram}
                      </a>
                    ) : null
                  }
                />
                <Row label="Réservation" value={salon.bookingTool !== "NONE" ? BOOKING_LABEL[salon.bookingTool] : null} />
                <Row label="Note" value={salon.rating ? `${salon.rating}/5` : null} />
                <Row label="Assigné à" value={salon.assignedTo?.name ?? salon.assignedTo?.email ?? null} />
                <Row label="Priorité" value={salon.priorityLabel} />
                <Row label="Lead" value={salon.leadTemperature} />
                <Row label="Source" value={salon.sourceLabel} />
                <Row label="Compte" value={salon.accountStatusLabel} />
                <Row label="Signature" value={formatDate(salon.signedAt)} />
                <Row label="Activation" value={formatDate(salon.activatedAt)} />
                <Row label="RDV" value={formatDate(salon.appointmentAt)} />
                <Row label="Clients importés" value={salon.clientBaseImported ? `${salon.importedClientCount ?? 0}` : null} />
              </dl>
              {salon.airtableRecordUrl && (
                <Link href={salon.airtableRecordUrl} className="mt-4 inline-flex text-sm font-medium text-rose-600 hover:text-rose-700">
                  Ouvrir dans Airtable →
                </Link>
              )}
            </div>
          </SalonEditModal>

          {(salon.notes || salon.objection) && (
            <div className={card}>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Notes Airtable</h2>
              {salon.notes && <p className="whitespace-pre-wrap text-sm text-slate-600">{salon.notes}</p>}
              {salon.objection && (
                <div className="mt-3 rounded-lg bg-amber-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Objection</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{salon.objection}</p>
                </div>
              )}
            </div>
          )}

          <div className={card}>
            <h2 className="mb-3 text-base font-semibold text-slate-950">Statut</h2>
            <form action={changeStatus.bind(null, id)} className="flex gap-2">
              <select name="status" defaultValue={salon.status} className={field}>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">OK</button>
            </form>
          </div>

          <div className={card}>
            <h2 className="mb-1 text-base font-semibold text-slate-950">Préparer le compte</h2>
            <p className="mb-4 text-sm text-slate-600">Crée un compte Glaura désactivé via le moteur d&apos;onboarding.</p>
            {latestJob ? (
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900">Dernier job</div>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1", onboardingStatusStyle[latestJob.status])}>
                    {onboardingStatusLabel[latestJob.status]}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{new Date(latestJob.updatedAt).toLocaleString("fr-FR")}</div>
                {latestJob.loginEmail && <div className="mt-2 font-medium text-slate-700">{latestJob.loginEmail}</div>}
                {latestJob.serviceCount != null && (
                  <div className="mt-1 text-xs font-medium text-slate-500">{latestJob.serviceCount} services · {latestJob.agentCount ?? 0} agents</div>
                )}
                {latestJob.error && <p className="mt-2 text-sm text-rose-700">{latestJob.error}</p>}
              </div>
            ) : null}
            <form action={triggerOnboarding.bind(null, id)}>
              <button
                disabled={!canTrigger}
                className="w-full rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
              >
                {onboardingBusy ? "Onboarding en cours" : "Préparer le compte"}
              </button>
            </form>
            {!canTrigger && (
              <p className="mt-2 text-xs text-slate-400">
                {!hasBookingUrl
                  ? "Ajoute une URL de réservation avant de lancer l'onboarding."
                  : onboardingBusy
                    ? "Un job est déjà en cours."
                    : salon.status !== "SIGNE"
                    ? "Disponible une fois le salon Signé."
                    : "Réservé au commercial assigné ou à un admin."}
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
              <textarea name="notes" rows={2} className={textareaField} placeholder="Notes…" />
              <button className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">Enregistrer</button>
            </form>
          </div>

          <div className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Historique</h2>
            {visibleActivities.length === 0 ? (
              <p className="text-sm text-slate-400">Aucune activité.</p>
            ) : (
              <ul className="space-y-3">
                {visibleActivities.map((a) => (
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
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Email</h2>
            <EmailFollowUpForm
              action={queueFollowUpEmail.bind(null, id)}
              salon={{
                name: salon.name,
                contactName: salon.contactName,
                contactEmail: salon.contactEmail,
                bookingUrl: salon.bookingUrl,
              }}
            />
            {salon.emailJobs.length > 0 && (
              <ul className="mt-4 space-y-2">
                {salon.emailJobs.map((job) => (
                  <li key={job.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-slate-700">{job.subject}</span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-semibold ring-1", emailStatusStyle[job.status])}>
                        {emailStatusLabel[job.status]}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-slate-400">
                      <span className="truncate">{job.to}</span>
                      <span className="shrink-0">{job.sentAt ? timeAgo(job.sentAt) : timeAgo(job.createdAt)}</span>
                    </div>
                    {job.lastError && <p className="mt-1 text-rose-600">{job.lastError}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Rappel / Relance</h2>
            <form action={addReminder.bind(null, id)} className="space-y-2">
              <input name="title" className={field} placeholder="Relancer pour la démo…" required />
              <input name="dueAt" type="datetime-local" className={field} required />
              <button className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">Ajouter</button>
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

function Row({ label, value }: { label: string; value?: React.ReactNode | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value ?? "—"}</dd>
    </div>
  );
}

function formatDate(value?: Date | string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("fr-FR");
}
