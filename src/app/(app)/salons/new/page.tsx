import Link from "next/link";
import { SalonForm } from "@/components/SalonForm";
import { createSalon } from "@/lib/actions";

export default function NewSalonPage() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link href="/salons" className="text-sm text-slate-500 hover:text-slate-700">← Salons</Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold text-slate-900">Ajouter un salon</h1>
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <SalonForm action={createSalon} />
      </div>
    </div>
  );
}
