"use client";
import Link from "next/link";
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="mx-auto max-w-lg p-8"><h1 className="text-2xl font-semibold text-slate-950">Cette action n’a pas pu aboutir</h1><p className="mt-3 text-sm text-slate-600">Votre accès a peut-être changé ou le service est temporairement indisponible. Actualisez la page puis réessayez.</p><div className="mt-6 flex gap-4"><button onClick={reset} className="rounded-lg bg-rose-600 px-4 py-2 text-sm text-white">Réessayer</button><Link href="/dashboard" className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Revenir à l’accueil</Link></div></div>;
}
