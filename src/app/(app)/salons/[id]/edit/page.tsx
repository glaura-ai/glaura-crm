import Link from "next/link";
import { notFound } from "next/navigation";
import { SalonForm } from "@/components/SalonForm";
import { updateSalon } from "@/lib/actions";
import { getSalon } from "@/lib/salons";

export default async function EditSalonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const salon = await getSalon(id);
  if (!salon) notFound();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link href={`/salons/${id}`} className="text-sm text-slate-500 hover:text-slate-700">← {salon.name}</Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold text-slate-900">Modifier le salon</h1>
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <SalonForm action={updateSalon.bind(null, id)} salon={salon} />
      </div>
    </div>
  );
}
