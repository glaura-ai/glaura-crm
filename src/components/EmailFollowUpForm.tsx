"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { renderTemplate, type EmailSalonDraftInput } from "@/lib/emailTemplates";

/** The template fields this form needs — the page selects exactly these. */
export type EmailTemplateOption = {
  id: string;
  label: string;
  subject: string;
  body: string;
};

type Props = {
  action: (fd: FormData) => void | Promise<void>;
  salon: EmailSalonDraftInput & { contactEmail?: string | null };
  templates: EmailTemplateOption[];
};

const field = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 disabled:bg-slate-50 disabled:text-slate-400";
const textareaField = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 disabled:bg-slate-50 disabled:text-slate-400";

export function EmailFollowUpForm({ action, salon, templates }: Props) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const initialRecipient = isValidEmail(salon.contactEmail) ? salon.contactEmail!.trim() : "";
  const [recipient, setRecipient] = useState(initialRecipient);

  const selected = useMemo(
    () => templates.find((template) => template.id === templateId) ?? templates[0],
    [templates, templateId],
  );

  // Recomputed on every switch so the preview always matches the dropdown; the
  // `key` props below then reset the editable fields to the new draft.
  const draft = useMemo(
    () =>
      selected
        ? { subject: renderTemplate(selected.subject, salon), body: renderTemplate(selected.body, salon) }
        : { subject: "", body: "" },
    [selected, salon],
  );

  const canQueue = isValidEmail(recipient) && !!selected;

  if (templates.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Aucun modèle d&apos;email.{" "}
        <Link href="/modeles" className="font-semibold text-rose-600 hover:underline">
          Créer un modèle
        </Link>
      </p>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input
        name="to"
        type="email"
        value={recipient}
        onChange={(event) => setRecipient(event.target.value)}
        className={field}
        placeholder="contact@salon.fr"
        required
      />
      <select
        name="templateId"
        value={selected?.id ?? ""}
        onChange={(event) => setTemplateId(event.target.value)}
        className={field}
      >
        {templates.map((template) => (
          <option key={template.id} value={template.id}>{template.label}</option>
        ))}
      </select>
      <input key={`${selected?.id}-subject`} name="subject" defaultValue={draft.subject} className={field} required />
      <textarea key={`${selected?.id}-body`} name="body" rows={7} defaultValue={draft.body} className={textareaField} required />
      <button
        disabled={!canQueue}
        className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
      >
        Envoyer
      </button>
      <div className="flex items-center justify-between">
        {!canQueue ? (
          <p className="text-xs text-slate-400">Ajoute un email contact pour envoyer une relance.</p>
        ) : (
          <span />
        )}
        <Link href="/modeles" className="text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline">
          Gérer les modèles
        </Link>
      </div>
    </form>
  );
}

function isValidEmail(value?: string | null): value is string {
  return Boolean(value?.trim().match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));
}
