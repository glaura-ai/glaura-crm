"use client";

import { useMemo, useState } from "react";
import { buildEmailDraft, EMAIL_TEMPLATE_LABEL, EMAIL_TEMPLATES, type EmailTemplateKey } from "@/lib/emailTemplates";

type Props = {
  action: (fd: FormData) => void | Promise<void>;
  salon: {
    name: string;
    contactName?: string | null;
    contactEmail?: string | null;
    bookingUrl?: string | null;
  };
};

const field = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 disabled:bg-slate-50 disabled:text-slate-400";
const textareaField = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 disabled:bg-slate-50 disabled:text-slate-400";

export function EmailFollowUpForm({ action, salon }: Props) {
  const [template, setTemplate] = useState<EmailTemplateKey>("RELANCE");
  const draft = useMemo(() => buildEmailDraft(template, salon), [template, salon]);
  const hasEmail = Boolean(salon.contactEmail);

  return (
    <form action={action} className="space-y-2">
      <input name="to" type="email" defaultValue={salon.contactEmail || ""} className={field} placeholder="contact@salon.fr" disabled={!hasEmail} required />
      <select
        name="template"
        value={template}
        onChange={(event) => setTemplate(event.target.value as EmailTemplateKey)}
        className={field}
        disabled={!hasEmail}
      >
        {EMAIL_TEMPLATES.map((key) => (
          <option key={key} value={key}>{EMAIL_TEMPLATE_LABEL[key]}</option>
        ))}
      </select>
      <input key={`${template}-subject`} name="subject" defaultValue={draft.subject} className={field} disabled={!hasEmail} required />
      <textarea key={`${template}-body`} name="body" rows={7} defaultValue={draft.body} className={textareaField} disabled={!hasEmail} required />
      <button
        disabled={!hasEmail}
        className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
      >
        Mettre en file
      </button>
      {!hasEmail && <p className="text-xs text-slate-400">Ajoute un email contact pour envoyer une relance.</p>}
    </form>
  );
}
