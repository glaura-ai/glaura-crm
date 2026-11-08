import Link from "next/link";
export default function NotFound() {
  return <main className="mx-auto max-w-lg p-10"><p className="text-sm text-rose-600">Page introuvable</p><h1 className="mt-2 text-2xl font-semibold">Cette page n’est pas disponible</h1><p className="mt-3 text-sm text-slate-600">Le lien a changé ou vous n’avez pas accès à cette fiche.</p><Link href="/dashboard" className="mt-6 inline-block rounded-lg bg-slate-950 px-4 py-2 text-sm text-white">Revenir à l’accueil</Link></main>;
}
