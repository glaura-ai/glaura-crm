import Link from "next/link";
import { SalonForm } from "@/components/SalonForm";
import { createSalon } from "@/lib/actions";

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
