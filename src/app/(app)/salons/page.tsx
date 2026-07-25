import Link from "next/link";
import { auth } from "@/auth";
import { getSalonOwners, getSalons } from "@/lib/salons";
import { SalonCard } from "@/components/SalonCard";
import { PipelineFilters } from "@/components/PipelineFilters";

export default async function SalonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await auth();
  const viewer = session?.user ? { id: session.user.id, role: session.user.role } : undefined;
  const isAdmin = viewer?.role === "ADMIN";
  const filterParams = isAdmin ? sp : { ...sp, owner: undefined };
  const [salons, owners] = await Promise.all([getSalons(filterParams, viewer), isAdmin ? getSalonOwners() : Promise.resolve([])]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Salons</h1>
          <p className="text-sm text-slate-500">{salons.length} salon{salons.length > 1 ? "s" : ""} affiché{salons.length > 1 ? "s" : ""}</p>
        </div>
        <Link href="/salons/new" className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600">
          + Ajouter un salon
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <PipelineFilters params={filterParams} owners={owners} />
        <form className="flex" action="/salons">
          {/* preserve active filters on search */}
          {Object.entries(filterParams).filter(([k]) => k !== "q").map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
          <input
            name="q"
            defaultValue={filterParams.q ?? ""}
            placeholder="Nom, téléphone, email, adresse, compte Insta…"
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
          />
        </form>
      </div>

      {salons.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
          Aucun salon ne correspond à ces filtres.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {salons.map((s) => (
            <SalonCard key={s.id} salon={s} />
          ))}
        </div>
      )}
    </div>
  );
}
