import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { SalonForm } from "@/components/SalonForm";
import { updateSalon } from "@/lib/actions";
import { getSalon } from "@/lib/salons";

export default async function EditSalonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const me = session?.user;
  const salon = await getSalon(id, me ? { id: me.id, role: me.role } : undefined);
  if (!salon) notFound();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href={`/salons/${id}`} className="text-sm text-slate-500 hover:text-slate-700">← {salon.name}</Link>
      <h1 className="mb-4 mt-2 text-3xl font-semibold text-slate-950">Modifier le salon</h1>
      <div className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
        <SalonForm action={updateSalon.bind(null, id)} salon={salon} />
      </div>
    </div>
  );
}
