"use client";

import { useState } from "react";
import { TEMPLATE_VARIABLES, renderTemplate, unknownVariables } from "@/lib/emailTemplates";
import { SubmitButton } from "@/components/SubmitButton";

// Stand-in salon for the preview. Deliberately has a booking URL so authors can
// see what {{bookingUrl}} produces; the empty case is explained in the legend.
const SAMPLE_SALON = {
  name: "Salon Démo",
  contactName: "Marie Dupont",
  bookingUrl: "https://www.planity.com/salon-demo",
};

type Props = {
  action: (fd: FormData) => void | Promise<void>;
  template?: { label: string; subject: string; body: string };
  submitLabel: string;
  onCancel?: never;
};

const field = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100";
const textareaField = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100";
const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

export function EmailTemplateForm({ action, template, submitLabel }: Props) {
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");

  // Typos are warned about, never blocked — an unknown token renders literally,
  // which is recoverable, and a hard block would be maddening mid-edit.
  const unknown = Array.from(new Set([...unknownVariables(subject), ...unknownVariables(body)]));

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div>
          <label className={label} htmlFor="label">Nom</label>
          <input id="label" name="label" defaultValue={template?.label ?? ""} className={field} required minLength={2} maxLength={60} placeholder="Relance" />
        </div>
        <div>
          <label className={label} htmlFor="subject">Objet</label>
          <input
            id="subject"
            name="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className={field}
            required
            minLength={2}
            maxLength={160}
            placeholder="Relance Glaura - {{salon}}"
          />
        </div>
        <div>
          <label className={label} htmlFor="body">Corps</label>
          <textarea
            id="body"
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={12}
            className={textareaField}
            required
            minLength={10}
            maxLength={6000}
            placeholder={"Bonjour {{contact}},\n\n…"}
          />
        </div>
        <SubmitButton className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
          {submitLabel}
        </SubmitButton>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className={label}>Variables</div>
          <ul className="space-y-1">
            {TEMPLATE_VARIABLES.map((variable) => (
              <li key={variable.token} className="text-xs text-slate-600">
                <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-rose-600 ring-1 ring-slate-200">{variable.token}</code>{" "}
                {variable.label}
                {variable.hint && <span className="text-slate-400"> — {variable.hint}</span>}
              </li>
            ))}
          </ul>
        </div>

        {unknown.length > 0 && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
            Variable inconnue : {unknown.join(", ")} — elle sera envoyée telle quelle.
          </p>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className={label}>Aperçu</div>
          <p className="text-sm font-semibold text-slate-900">{renderTemplate(subject, SAMPLE_SALON) || "—"}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{renderTemplate(body, SAMPLE_SALON) || "—"}</p>
        </div>
      </div>
    </form>
  );
}
