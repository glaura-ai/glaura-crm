import Link from "next/link";
import type { SalonListItem } from "@/lib/salons";
import { Stars } from "@/components/Stars";
import { SalonCardActions } from "@/components/SalonCardActions";
import {
  ACCOUNT_ATTENTION_LABEL,
  ACCOUNT_ATTENTION_STYLE,
  METIER_LABEL,
  STATUS_LABEL,
  STATUS_STYLE,
  TYPE_STYLE,
} from "@/lib/labels";
import { cn } from "@/lib/utils";

export function SalonCard({ salon, canDelete = false }: { salon: SalonListItem; canDelete?: boolean }) {
  return (
    <div className="group relative rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-rose-200">
      <Link href={`/salons/${salon.id}`} aria-label={`Ouvrir ${salon.name}`} className="absolute inset-0 rounded-2xl" />

      {salon.type && (
        <span className={cn("absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white", TYPE_STYLE[salon.type])}>
          {salon.type}
        </span>
      )}

      <h3 className="pr-8 font-semibold text-slate-900">{salon.name}</h3>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {salon.metier.map((m) => (
          <span key={m} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {METIER_LABEL[m]}
          </span>
        ))}
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[salon.status])}>{STATUS_LABEL[salon.status]}</span>
        {salon.accountStatusLabel && ACCOUNT_ATTENTION_LABEL[salon.accountStatusLabel] && (
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ACCOUNT_ATTENTION_STYLE[salon.accountStatusLabel])}>
            {ACCOUNT_ATTENTION_LABEL[salon.accountStatusLabel]}
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-500">{salon.address ?? "Adresse inconnue"}</p>
      {(salon.contactName || salon.assignedTo) && (
        <p className="mt-1 truncate text-xs text-slate-400">
          {salon.contactName ? `${salon.contactName}` : ""}
          {salon.contactName && salon.assignedTo ? " · " : ""}
          {salon.assignedTo?.name ?? salon.assignedTo?.email ?? ""}
        </p>
      )}

      {/* pointer-coarse: the action pill is always visible on touch screens — pad so it never covers the stars */}
      <div className="mt-3 flex items-center justify-between text-sm pointer-coarse:pr-16">
        {salon.instagram ? (
          <a
            href={`https://www.instagram.com/${salon.instagram}`}
            target="_blank"
            rel="noreferrer"
            className="relative z-10 font-medium text-rose-600 hover:text-rose-700 hover:underline"
          >
            @{salon.instagram}
          </a>
        ) : (
          <span className="text-slate-300">—</span>
        )}
        <Stars rating={salon.rating} />
      </div>

      <SalonCardActions salonId={salon.id} salonName={salon.name} canDelete={canDelete} />
    </div>
  );
}
