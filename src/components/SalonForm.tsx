import { METIER_ORDER, METIER_LABEL, STATUS_ORDER, STATUS_LABEL, BOOKING_LABEL } from "@/lib/labels";
import type { SalonDetail } from "@/lib/salons";

const TYPES = ["A", "B", "C", "D"] as const;
const TOOLS = ["NONE", "PLANITY", "TREATWELL", "ACUITY", "SITE"] as const;

const field = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100";
const labelCls = "mb-1 block text-xs font-medium text-slate-500";

export function SalonForm({ action, salon }: { action: (fd: FormData) => Promise<void>; salon?: SalonDetail | null }) {
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className={labelCls}>Nom du salon *</label>
        <input name="name" required defaultValue={salon?.name ?? ""} className={field} placeholder="ex. Zazen Marais" />
      </div>

      <div>
        <label className={labelCls}>Métiers</label>
        <div className="flex flex-wrap gap-2">
          {METIER_ORDER.map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm has-[:checked]:border-rose-300 has-[:checked]:bg-rose-50">
              <input type="checkbox" name="metier" value={m} defaultChecked={salon?.metier?.includes(m) ?? false} className="accent-rose-500" />
              {METIER_LABEL[m]}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Type (taille du deal)</label>
          <select name="type" defaultValue={salon?.type ?? ""} className={field}>
            <option value="">—</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>Type {t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Statut</label>
          <select name="status" defaultValue={salon?.status ?? "A_VISITER"} className={field}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Arrondissement / CP</label>
          <input name="arrondissement" defaultValue={salon?.arrondissement ?? ""} className={field} placeholder="75004" />
        </div>
        <div>
          <label className={labelCls}>Téléphone</label>
          <input name="phone" defaultValue={salon?.phone ?? ""} className={field} placeholder="01 23 45 67 89" />
        </div>
      </div>

      <div>
        <label className={labelCls}>Adresse</label>
        <input name="address" defaultValue={salon?.address ?? ""} className={field} placeholder="12 rue de Rivoli, 75004 Paris" />
      </div>

      <div>
        <label className={labelCls}>Instagram</label>
        <input name="instagram" defaultValue={salon?.instagram ?? ""} className={field} placeholder="zazen.paris" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Outil de réservation</label>
          <select name="bookingTool" defaultValue={salon?.bookingTool ?? "NONE"} className={field}>
            {TOOLS.map((t) => (
              <option key={t} value={t}>{BOOKING_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>URL de réservation</label>
          <input name="bookingUrl" defaultValue={salon?.bookingUrl ?? ""} className={field} placeholder="https://…" />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="submit" className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600">
          {salon ? "Enregistrer" : "Créer le salon"}
        </button>
      </div>
    </form>
  );
}
