import Link from "next/link";
import type { SalonListItem } from "@/lib/salons";
import { METIER_LABEL, STATUS_LABEL, STATUS_STYLE, TYPE_STYLE } from "@/lib/labels";
import { cn } from "@/lib/utils";

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return null;
  const full = Math.round(rating);
  return (
    <span className="text-amber-400" title={`${rating}/5`}>
      {"★".repeat(full)}
      <span className="text-slate-200">{"★".repeat(5 - full)}</span>
    </span>
  );
}

export function SalonCard({ salon }: { salon: SalonListItem }) {
  return (
    <Link
      href={`/salons/${salon.id}`}
      className="group relative block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-rose-200"
    >
      {salon.type && (
        <span className={cn("absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white", TYPE_STYLE[salon.type])}>
          {salon.type}
        </span>
      )}

      <h3 className="pr-8 font-semibold text-slate-900">{salon.name}</h3>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{METIER_LABEL[salon.metier]}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[salon.status])}>{STATUS_LABEL[salon.status]}</span>
      </div>

      <p className="mt-2 text-sm text-slate-500">{salon.address ?? "Adresse inconnue"}</p>

      <div className="mt-3 flex items-center justify-between text-sm">
        {salon.instagram ? (
          <span className="text-rose-600">@{salon.instagram}</span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
        <Stars rating={salon.rating} />
      </div>
    </Link>
  );
}
