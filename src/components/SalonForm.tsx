import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { METIER_ORDER, METIER_LABEL, STATUS_ORDER, STATUS_LABEL, BOOKING_LABEL } from "@/lib/labels";
import type { SalonDetail } from "@/lib/salons";

const TYPES = ["A", "B", "C", "D"] as const;
const TOOLS = ["NONE", "PLANITY", "TREATWELL", "ACUITY", "SITE"] as const;

const field = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100";
const textareaField = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100";
const labelCls = "mb-1.5 block text-sm font-medium text-slate-700";

export type SalonFormValues = Pick<
  SalonDetail,
  | "name"
  | "metier"
  | "type"
  | "status"
  | "arrondissement"
  | "phone"
  | "contactName"
  | "contactEmail"
  | "address"
  | "lat"
  | "lng"
  | "instagram"
  | "bookingTool"
  | "bookingUrl"
  | "notes"
  | "assignedToId"
>;

export type AssignableUser = { id: string; name: string | null; email: string };

export function SalonForm({
  action,
  salon,
  isAdmin = false,
  assignableUsers = [],
  pinnedToday = false,
}: {
  action: (fd: FormData) => Promise<void>;
  salon?: SalonFormValues | null;
  isAdmin?: boolean;
  assignableUsers?: AssignableUser[];
  pinnedToday?: boolean;
}) {
  return (
    <form action={action} className="space-y-4">
      {isAdmin && assignableUsers.length > 0 && (
        <div>
          <label className={labelCls}>Assigné à</label>
          <select name="assignedToId" defaultValue={salon?.assignedToId ?? ""} className={field}>
            <option value="">— Non assigné</option>
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
            ))}
          </select>
        </div>
      )}

      {salon && (
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-sm font-medium text-amber-800 has-[:checked]:border-amber-300 has-[:checked]:bg-amber-50">
          <input type="checkbox" name="priorityToday" defaultChecked={pinnedToday} className="h-4 w-4 accent-amber-500" />
          ★ Priorité du jour <span className="font-normal text-amber-700/80">— mettre en avant sur le tableau de bord du commercial assigné aujourd&apos;hui</span>
        </label>
      )}
      <div>
        <label className={labelCls}>Nom du salon *</label>
        <input name="name" required defaultValue={salon?.name ?? ""} className={field} placeholder="ex. Zazen Marais" />
      </div>

      <div>
        <label className={labelCls}>Métiers</label>
        <div className="flex flex-wrap gap-2">
          {METIER_ORDER.map((m) => (
            <label key={m} className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm has-[:checked]:border-rose-400 has-[:checked]:bg-rose-50 has-[:checked]:text-rose-700">
              <input type="checkbox" name="metier" value={m} defaultChecked={salon?.metier?.includes(m) ?? false} className="h-4 w-4 accent-rose-500" />
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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Nom du contact</label>
          <input name="contactName" defaultValue={salon?.contactName ?? ""} className={field} placeholder="Responsable du salon" />
        </div>
        <div>
          <label className={labelCls}>Email contact</label>
          <input name="contactEmail" type="email" defaultValue={salon?.contactEmail ?? ""} className={field} placeholder="contact@salon.fr" />
        </div>
      </div>

      <div>
        <label className={labelCls}>Adresse</label>
        <AddressAutocomplete defaultValue={salon?.address} defaultLat={salon?.lat} defaultLng={salon?.lng} inputClassName={field} />
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

      <div>
        <label className={labelCls}>Notes</label>
        <textarea name="notes" defaultValue={salon?.notes ?? ""} rows={3} className={textareaField} placeholder="Contexte, objections, prochaine action…" />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="submit" className="rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-600">
          {salon ? "Enregistrer" : "Créer le salon"}
        </button>
      </div>
    </form>
  );
}
