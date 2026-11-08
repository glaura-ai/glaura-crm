import Link from "next/link";
import { requireMember } from "@/lib/access";
import { STATUS_LABEL } from "@/lib/labels";
import { frenchDate } from "@/lib/crm-format";
import { getSalonCount, getSalonOwners, getSalons } from "@/lib/salons";
import { SalonCard } from "@/components/SalonCard";
import { PipelineFilters } from "@/components/PipelineFilters";

export default async function SalonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const viewer = await requireMember();
  const isAdmin = viewer?.role === "ADMIN";
  const filterParams = isAdmin ? sp : { ...sp, owner: undefined };
  const [salons, owners, total] = await Promise.all([getSalons(filterParams, viewer), isAdmin ? getSalonOwners() : Promise.resolve([]), getSalonCount(filterParams, viewer)]);
  const page = Math.max(1, Math.min(100000, Number.parseInt(sp.page ?? "", 10) || 1));
  const href = (updates: Record<string, string>) => { const qs = new URLSearchParams(); for (const [key, value] of Object.entries(sp)) if (value) qs.set(key, value); for (const [key, value] of Object.entries(updates)) qs.set(key, value); return `/salons?${qs}`; };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Salons</h1>
          <p className="text-sm text-slate-500">{total.toLocaleString("fr-FR")} salons · historique conservé</p>
        </div>
        <Link href="/salons/new" className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600">
          + Ajouter un salon
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <PipelineFilters params={filterParams} owners={owners} />
        <form className="flex" action="/salons">
          {/* preserve active filters on search */}
          {Object.entries(filterParams).filter(([k]) => k !== "q" && k !== "page").map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
          <input
            name="q"
            defaultValue={filterParams.q ?? ""}
            placeholder="Nom, téléphone, email, adresse, compte Insta…"
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
          />
        </form>
      </div>

      <div className="mb-4 flex gap-3 text-sm"><Link href={href({ view: "table", page: "1" })} className="rounded-lg border border-slate-200 bg-white px-3 py-2">Vue tableau</Link><Link href={href({ view: "cards", page: "1" })} className="rounded-lg border border-slate-200 bg-white px-3 py-2">Vue fiches</Link></div>
      {salons.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
          Aucun salon ne correspond à ces filtres.
        </div>
      ) : sp.view !== "cards" ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{["Salon", "Statut", "Responsable", "Contact", "Prochaine action", ""].map((title, i) => <th key={i} className="p-4 font-medium">{title}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{salons.map(s => <tr key={s.id} className="hover:bg-slate-50"><td className="p-4"><Link href={`/salons/${s.id}`} className="font-semibold text-slate-900 hover:text-rose-700">{s.name}</Link><p className="mt-1 text-xs text-slate-500">{s.address ?? s.arrondissement}</p></td><td className="p-4">{STATUS_LABEL[s.status]}</td><td className="p-4">{s.assignedTo?.name ?? s.assignedTo?.email ?? "Non attribué"}</td><td className="p-4"><p>{s.phone ?? s.contactEmail ?? "À compléter"}</p>{s.instagram && <a href={`https://www.instagram.com/${s.instagram}`} target="_blank" rel="noreferrer" className="text-xs text-violet-700">@{s.instagram}</a>}</td><td className="p-4">{s.tasks[0] ? <><p>{s.tasks[0].title}</p><p className="mt-1 text-xs text-slate-500">{frenchDate(s.tasks[0].dueAt)}</p></> : s.nextActionAt ? frenchDate(s.nextActionAt) : "À planifier"}</td><td className="p-4"><Link href={`/taches?salon=${s.id}`} className="whitespace-nowrap text-rose-700">Créer une tâche →</Link></td></tr>)}</tbody></table></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {salons.map((s) => (
            <SalonCard key={s.id} salon={s} canDelete={isAdmin} />
          ))}
        </div>
      )}
      <div className="mt-5 flex items-center justify-between text-sm text-slate-600"><span>Page {page} sur {Math.max(1, Math.ceil(total / 50))}</span><div className="flex gap-4">{page > 1 && <Link href={href({ page: String(page - 1) })}>Précédent</Link>}{page * 50 < total && <Link href={href({ page: String(page + 1) })}>Suivant</Link>}</div></div>
    </div>
  );
}
