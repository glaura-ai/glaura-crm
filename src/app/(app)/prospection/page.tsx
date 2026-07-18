import { getAssignableUsers } from "@/lib/salons";
import { generateTournee } from "@/lib/prospection/actions";
import { getProspectionStats, getTodaysTournees, getZoneAvailability } from "@/lib/prospection/queries";
import { zoneLabel } from "@/lib/prospection/zones";
import { ProspectCard } from "@/components/prospection/ProspectCard";

const DEPT_LABEL: Record<string, string> = {
  "75": "Paris",
  "92": "Hauts-de-Seine",
  "93": "Seine-Saint-Denis",
  "94": "Val-de-Marne",
};

export default async function ProspectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const [zones, tournees, stats, users] = await Promise.all([
    getZoneAvailability(),
    getTodaysTournees(),
    getProspectionStats(),
    getAssignableUsers(),
  ]);

  const depts = [...new Set(zones.map((z) => z.dept))];

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-900">Prospection</h1>
        <p className="text-sm text-slate-500">
          {stats.nouveau} salons disponibles · {stats.enTournee} en tournée · {stats.converti} convertis ·{" "}
          {stats.dejaCrm} déjà dans le CRM
        </p>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">{sp.error}</div>
      )}

      <section className="mb-8 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 font-semibold text-slate-900">Tournée du jour</h2>
        <form action={generateTournee} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Zone
            <select
              name="zone"
              required
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-300"
            >
              {depts.map((dept) => (
                <optgroup key={dept} label={DEPT_LABEL[dept] ?? dept}>
                  {zones
                    .filter((zone) => zone.dept === dept)
                    .map((zone) => (
                      <option key={zone.slug} value={zone.slug} disabled={zone.available === 0}>
                        {zone.label} ({zone.available} dispo)
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Assignée à
            <select
              name="assignedToId"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-300"
            >
              <option value="">—</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name ?? user.email}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Salons
            <input
              type="number"
              name="size"
              defaultValue={25}
              min={5}
              max={30}
              className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-300"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Tier min
            <select
              name="minTier"
              defaultValue="1"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-300"
            >
              <option value="1">Tous</option>
              <option value="2">T2+ (Actif)</option>
              <option value="3">T3+ (Établi)</option>
              <option value="4">T4 (Référence)</option>
            </select>
          </label>
          <button className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600">
            Générer la tournée
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-400">
          Sélection triée par tier (T1 base → T4 référence, selon avis + followers), hors salons déjà dans le CRM. Pool
          alimenté par <code className="rounded bg-slate-100 px-1">npm run prospect:sweep</code>.
        </p>
      </section>

      {tournees.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
          Aucune tournée aujourd&apos;hui — génère la première ci-dessus.
        </div>
      ) : (
        tournees.map((tournee) => {
          const active = tournee.prospects.filter((p) => p.status === "EN_TOURNEE");
          const converted = tournee.prospects.length - active.length;
          return (
            <section key={tournee.id} className="mb-8">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-slate-900">
                  {zoneLabel(tournee.zone)}
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {active.length} à visiter{converted > 0 ? ` · ${converted} traité${converted > 1 ? "s" : ""}` : ""}
                  </span>
                </h2>
                <span className="text-sm text-slate-500">
                  {tournee.assignedTo ? `👤 ${tournee.assignedTo.name ?? tournee.assignedTo.email}` : "Non assignée"}
                </span>
              </div>
              {active.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
                  Tournée terminée 🎉
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {active.map((prospect) => (
                    <ProspectCard key={prospect.id} prospect={prospect} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
