import type { Metier, ProspectSource } from "@/generated/prisma/enums";
import { convertProspect, discardProspect, releaseProspect, validateInstagram } from "@/lib/prospection/actions";
import { METIER_LABEL, PROSPECT_SOURCE_LABEL, PROSPECT_SOURCE_STYLE } from "@/lib/labels";
import type { IgCandidateJson, TourneeProspect } from "@/lib/prospection/queries";
import { TIER_LABEL, TIER_STYLE } from "@/lib/prospection/tier";
import { Stars } from "@/components/Stars";
import { cn } from "@/lib/utils";

function formatFollowers(count: number | null): string | null {
  if (count == null) return null;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1_000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function igCandidatesOf(prospect: TourneeProspect): IgCandidateJson[] {
  if (!Array.isArray(prospect.igCandidates)) return [];
  return (prospect.igCandidates as IgCandidateJson[]).filter((c) => c && typeof c.username === "string");
}

function mapsUrl(p: TourneeProspect): string {
  const query = p.address ? `${p.name}, ${p.address}` : `${p.name}, ${p.postalCode ?? ""} ${p.city ?? "Paris"}`;
  return `https://maps.google.com/?q=${encodeURIComponent(query)}`;
}

function instagramUrl(p: TourneeProspect): string {
  if (p.instagram) return `https://www.instagram.com/${p.instagram}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`instagram ${p.name} ${p.city ?? "Paris"}`)}`;
}

export function ProspectCard({ prospect }: { prospect: TourneeProspect }) {
  const source = prospect.source as ProspectSource;
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">{prospect.name}</h3>
          <p className="text-sm text-slate-500">{prospect.address ?? `${prospect.postalCode ?? ""} ${prospect.city ?? ""}`}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TIER_STYLE[prospect.tier])}
            title={`Tier ${prospect.tier} — ${TIER_LABEL[prospect.tier]}`}
          >
            T{prospect.tier}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", PROSPECT_SOURCE_STYLE[source])}>
            {PROSPECT_SOURCE_LABEL[source]}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Stars rating={prospect.rating} />
        <span className="font-medium text-slate-700">{prospect.reviewCount} avis</span>
        {(prospect.metiers as Metier[]).map((metier) => (
          <span key={metier} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {METIER_LABEL[metier]}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <a href={prospect.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-rose-600 hover:underline">
          Réservation ↗
        </a>
        <a href={mapsUrl(prospect)} target="_blank" rel="noreferrer" className="font-medium text-sky-600 hover:underline">
          Maps ↗
        </a>
        <a href={instagramUrl(prospect)} target="_blank" rel="noreferrer" className="font-medium text-violet-600 hover:underline">
          {prospect.instagram ? `@${prospect.instagram}` : "Chercher l'Insta ↗"}
        </a>
        {prospect.instagram && formatFollowers(prospect.instagramFollowers) && (
          <span className="text-slate-500">{formatFollowers(prospect.instagramFollowers)} followers</span>
        )}
      </div>

      {!prospect.instagram && prospect.igStatus === "A_VALIDER" && igCandidatesOf(prospect).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-violet-50 p-2 text-xs">
          <span className="font-medium text-violet-700">Insta à valider :</span>
          {igCandidatesOf(prospect).map((candidate) => (
            <span key={candidate.username} className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 ring-1 ring-violet-200">
              <a
                href={`https://www.instagram.com/${candidate.username}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-violet-700 hover:underline"
              >
                @{candidate.username}
              </a>
              {formatFollowers(candidate.followers) && <span className="text-slate-500">{formatFollowers(candidate.followers)}</span>}
              <form action={validateInstagram}>
                <input type="hidden" name="prospectId" value={prospect.id} />
                <input type="hidden" name="username" value={candidate.username} />
                <button title="Confirmer ce compte" className="font-semibold text-emerald-600 hover:text-emerald-700">
                  ✓
                </button>
              </form>
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex gap-2 border-t border-slate-100 pt-3">
        <form action={convertProspect} className="flex-1">
          <input type="hidden" name="prospectId" value={prospect.id} />
          <button className="w-full rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-600">
            → Salon
          </button>
        </form>
        <form action={releaseProspect}>
          <input type="hidden" name="prospectId" value={prospect.id} />
          <button title="Remettre dans le pool" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            Retirer
          </button>
        </form>
        <form action={discardProspect}>
          <input type="hidden" name="prospectId" value={prospect.id} />
          <button title="Écarter définitivement" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50 hover:text-rose-600">
            ✕
          </button>
        </form>
      </div>
    </div>
  );
}
