"use client";

import { useRef, useState, useTransition } from "react";
import {
  onboardingValues,
  renderTemplate,
  unknownVariables,
  variablesForFormat,
  type EmailFormat,
} from "@/lib/emailTemplates";
import { ACCEPTED_IMAGE_TYPES, imageWarnings } from "@/lib/emailImages";
import { uploadEmailImage } from "@/lib/actions";
import { EmailHtmlPreview } from "@/components/EmailHtmlPreview";
import { SubmitButton } from "@/components/SubmitButton";

// Stand-in salon for the preview. Deliberately has a booking URL so authors can
// see what {{bookingUrl}} produces; the empty case is explained in the legend.
const SAMPLE_SALON = {
  name: "Salon Démo",
  contactName: "Marie Dupont",
  bookingUrl: "https://www.planity.com/salon-demo",
};

// Stand-in account for the onboarding placeholders. The password is obviously
// fake so nobody mistakes a preview for a real credential.
const SAMPLE_ONBOARDING = onboardingValues({
  loginEmail: "contact@salon-demo.fr",
  password: "Exemple1234",
  pageUrl: "https://salon-demo.glaura.ai",
  portalUrl: "https://pro.glaura.ai",
  siteUrl: "https://glaura.ai",
  instagramUrl: "https://www.instagram.com/glaura.app/",
  supportEmail: "support@glaura.fr",
});

type Props = {
  action: (fd: FormData) => void | Promise<void>;
  template?: { label: string; subject: string; body: string; format: EmailFormat };
  submitLabel: string;
  onCancel?: never;
};

const field = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100";
const textareaField = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100";
const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

export function EmailTemplateForm({ action, template, submitLabel }: Props) {
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [format, setFormat] = useState<EmailFormat>(template?.format ?? "TEXT");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const isHtml = format === "HTML";

  // Typos are warned about, never blocked — an unknown token renders literally,
  // which is recoverable, and a hard block would be maddening mid-edit.
  const unknown = Array.from(new Set([...unknownVariables(subject, format), ...unknownVariables(body, format)]));
  const options = { format, values: isHtml ? SAMPLE_ONBOARDING : undefined };
  // Only HTML bodies carry images; a plaintext relance with an <img> in it is
  // not a case worth warning about.
  const brokenImages = isHtml ? imageWarnings(body) : [];

  /**
   * Uploads the picked file and drops an `<img>` for it at the caret. Inserting
   * the tag rather than just showing the URL is the point: an author working in
   * raw HTML should not have to hand-write the markup to see the image appear
   * in the preview.
   */
  function handleUpload(file: File) {
    setUploadError(null);
    startUpload(async () => {
      const payload = new FormData();
      payload.set("file", file);
      const result = await uploadEmailImage(payload);
      if (!result.ok) {
        setUploadError(result.error);
        return;
      }
      const tag = `<img src="${result.url}" alt="" width="200" style="display:block; width:200px; max-width:100%; height:auto; border:0;">`;
      const textarea = bodyRef.current;
      const caret = textarea?.selectionStart ?? body.length;
      setBody((current) => `${current.slice(0, caret)}${tag}${current.slice(caret)}`);
    });
  }

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div>
          <label className={label} htmlFor="label">Nom</label>
          <input id="label" name="label" defaultValue={template?.label ?? ""} className={field} required minLength={2} maxLength={60} placeholder="Relance" />
        </div>
        <div>
          <label className={label} htmlFor="format">Format</label>
          <select
            id="format"
            name="format"
            value={format}
            onChange={(event) => setFormat(event.target.value as EmailFormat)}
            className={field}
          >
            <option value="TEXT">Texte — relances commerciales</option>
            <option value="HTML">HTML — emails de compte</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">
            {isHtml
              ? "Le corps est du HTML d'email complet. Rien n'est supprimé, les valeurs sont échappées."
              : "Une ligne dont la variable est vide disparaît entièrement."}
          </p>
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
          <div className="flex items-end justify-between">
            <label className={label} htmlFor="body">Corps</label>
            {isHtml && (
              <label className="mb-1 cursor-pointer text-xs font-semibold text-rose-600 hover:underline">
                {uploading ? "Envoi…" : "+ Héberger une image"}
                <input
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(",")}
                  className="hidden"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // Reset so picking the same file twice fires onChange again.
                    event.target.value = "";
                    if (file) handleUpload(file);
                  }}
                />
              </label>
            )}
          </div>
          <textarea
            id="body"
            name="body"
            ref={bodyRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={isHtml ? 18 : 12}
            className={`${textareaField} ${isHtml ? "font-mono text-xs" : ""}`}
            required
            minLength={10}
            maxLength={isHtml ? 200000 : 6000}
            placeholder={isHtml ? "<!doctype html>…" : "Bonjour {{contact}},\n\n…"}
            spellCheck={!isHtml}
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
            {variablesForFormat(format).map((variable) => (
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

        {uploadError && (
          <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800 ring-1 ring-rose-200">{uploadError}</p>
        )}

        {brokenImages.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
            <p className="font-semibold">Images qui ne s&apos;afficheront pas</p>
            <ul className="mt-1 space-y-1">
              {brokenImages.map((warning) => (
                <li key={warning.src}>
                  <code className="font-mono text-[11px]">{warning.src.slice(0, 60)}{warning.src.length > 60 ? "…" : ""}</code>
                  <span className="text-amber-700"> — {warning.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className={label}>Aperçu</div>
          <p className="text-sm font-semibold text-slate-900">{renderTemplate(subject, SAMPLE_SALON, { format: "TEXT", values: options.values }) || "—"}</p>
          {isHtml ? (
            <EmailHtmlPreview html={renderTemplate(body, SAMPLE_SALON, options)} className="mt-2 h-[520px] w-full rounded-lg border border-slate-200 bg-white" />
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{renderTemplate(body, SAMPLE_SALON, options) || "—"}</p>
          )}
        </div>
      </div>
    </form>
  );
}
