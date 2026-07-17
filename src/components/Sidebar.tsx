import Link from "next/link";
import { signOut } from "@/auth";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  dashboard: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  salons: "M4 6h16M4 12h16M4 18h16",
  prospection: "M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11zM12 12a2 2 0 100-4 2 2 0 000 4z",
  onboarding: "M4 19V5M4 19h16M8 15l3-3 3 2 5-7",
  calendar: "M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z",
};

export function Sidebar({ user }: { user: { name?: string | null; email?: string | null; image?: string | null; role?: string | null } }) {
  const initial = (user.name || user.email || "?").charAt(0).toUpperCase();
  const isAdmin = user.role === "ADMIN";
  return (
    <aside className="flex w-16 flex-col items-center gap-1 border-r border-slate-200 bg-white py-4">
      <Link href="/dashboard" className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500 text-lg font-bold text-white">
        G
      </Link>
      <Link href="/dashboard" title="Tableau de bord" className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
        <Icon d={ICONS.dashboard} />
      </Link>
      <Link href="/salons" title="Salons" className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
        <Icon d={ICONS.salons} />
      </Link>
      <Link href="/prospection" title="Prospection" className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
        <Icon d={ICONS.prospection} />
      </Link>
      {isAdmin && (
        <Link href="/onboarding" title="Monitoring onboarding" className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <Icon d={ICONS.onboarding} />
        </Link>
      )}
      <div className="mt-auto flex flex-col items-center gap-2">
        <div title={user.email ?? ""} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
          {initial}
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button title="Se déconnecter" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600">
            <Icon d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
          </button>
        </form>
      </div>
    </aside>
  );
}
