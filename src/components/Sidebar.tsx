import Link from "next/link";
import { signOut } from "@/auth";
import { canAccessInstagram } from "@/lib/access";

export function Sidebar({ user }: { user: { name?: string | null; email?: string | null; role?: string } }) {
  const admin = user.role === "ADMIN";
  const links = [
    ["/dashboard", "Aujourd’hui", "◷"], ["/taches", admin ? "Suivi des actions" : "Mes tâches", "✓"],
    ["/prospection", admin ? "Prospection" : "Mes prospects", "⌕"], ["/salons", "Salons et suivi", "▤"],
    ...(canAccessInstagram(user) ? [["/instagram", "Messagerie Instagram", "◎"]] : []),
    ...(admin ? [["/modeles", "Modèles d’email", "✉"], ["/onboarding", "Création de comptes salons", "↗"], ["/administration", "Équipe et accès", "⚙"]] : []),
  ];
  return <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-slate-200 bg-white p-2 lg:w-60 lg:p-4"><Link href="/dashboard" className="mb-7 mt-2 flex items-center gap-3 px-1"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-xl font-bold text-white">G</span><span className="hidden text-lg font-semibold tracking-tight text-slate-950 lg:inline">Glaura <span className="text-slate-400">CRM</span></span></Link><nav aria-label="Navigation principale" className="flex flex-col gap-1">{links.map(([href, label, icon]) => <Link key={href} href={href} title={label} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700"><span aria-hidden className="w-5 shrink-0 text-center text-lg">{icon}</span><span className="hidden lg:inline">{label}</span></Link>)}</nav><div className="mt-auto border-t border-slate-100 pt-4"><div className="mb-3 hidden px-3 lg:block"><p className="truncate text-sm font-medium text-slate-900">{user.name ?? user.email}</p><p className="mt-1 text-xs text-slate-400">{admin ? "Administration" : "Espace commercial"}</p></div><form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}><button title="Se déconnecter" className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100"><span aria-hidden>↪</span><span className="ml-3 hidden lg:inline">Se déconnecter</span></button></form></div></aside>;
}
