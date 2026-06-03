import Link from "next/link";
import { METIER_LABEL, METIER_ORDER, STATUS_LABEL, STATUS_ORDER } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Params = Record<string, string | undefined>;

// Build an href that toggles `key`=`value` while preserving other filters.
function toggleHref(params: Params, key: string, value: string): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== key) next.set(k, v);
  if (params[key] !== value) next.set(key, value);
  const qs = next.toString();
  return qs ? `/salons?${qs}` : "/salons";
}

function Chip({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-3 py-1 text-sm font-medium transition",
        active ? "bg-rose-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      )}
    >
      {children}
    </Link>
  );
}

export function PipelineFilters({ params }: { params: Params }) {
  const TYPES = ["A", "B", "C", "D"] as const;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Chip active={!params.status} href={toggleHref({ ...params, status: undefined }, "status", "")}>
          Tous
        </Chip>
        {STATUS_ORDER.map((s) => (
          <Chip key={s} active={params.status === s} href={toggleHref(params, "status", s)}>
            {STATUS_LABEL[s]}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {METIER_ORDER.filter((m) => m !== "AUTRE").map((m) => (
          <Chip key={m} active={params.metier === m} href={toggleHref(params, "metier", m)}>
            {METIER_LABEL[m]}
          </Chip>
        ))}
        <span className="mx-1 w-px self-stretch bg-slate-200" />
        {TYPES.map((t) => (
          <Chip key={t} active={params.type === t} href={toggleHref(params, "type", t)}>
            Type {t}
          </Chip>
        ))}
      </div>
    </div>
  );
}
