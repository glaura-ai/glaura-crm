import Link from "next/link";
import { SalonForm } from "@/components/SalonForm";
import { createSalon } from "@/lib/actions";

// The form's double-submit token is minted per render, so this page must never
// be prerendered — a build-time token would be shared by every visitor and every
// "create" would silently resolve to the same salon. Today the auth check in the
// layout already forces dynamic rendering; this states the requirement outright
// so it cannot be lost.
export const dynamic = "force-dynamic";

export default function NewSalonPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href="/salons" className="text-sm text-slate-500 hover:text-slate-700">← Salons</Link>
      <h1 className="mb-4 mt-2 text-3xl font-semibold text-slate-950">Ajouter un salon</h1>
      <div className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
        <SalonForm action={createSalon} />
      </div>
    </div>
  );
}
