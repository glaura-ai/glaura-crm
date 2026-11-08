"use client";
import { useState } from "react";

export function ProspectSelection({ ids }: { ids: string[] }) {
  const [checked, setChecked] = useState(false);
  return <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={checked} onChange={e => {
    setChecked(e.target.checked);
    document.querySelectorAll<HTMLInputElement>('input[name="prospectId"][form="assign-prospects"]').forEach(input => { if (ids.includes(input.value)) input.checked = e.target.checked; });
  }} />Sélectionner cette page</label>;
}
