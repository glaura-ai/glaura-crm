"use client";

import { GLAURA_LOGO_CID, GLAURA_LOGO_PNG_BASE64 } from "@/lib/email-assets/glaura-logo";

/**
 * Renders an HTML email body the way a mail client would.
 *
 * `sandbox=""` keeps scripts, forms and navigation out of the CRM — a template
 * body is author-supplied markup, and the preview must not be able to act.
 *
 * The logo travels as a CID part in the real message, which a browser cannot
 * resolve, so the preview swaps it for the same bytes as a data URI. What the
 * author sees is therefore the same image the salon gets.
 */
export function EmailHtmlPreview({ html, className }: { html: string; className?: string }) {
  const previewable = html.split(`cid:${GLAURA_LOGO_CID}`).join(`data:image/png;base64,${GLAURA_LOGO_PNG_BASE64}`);

  return (
    <iframe
      title="Aperçu de l'email"
      sandbox=""
      srcDoc={previewable}
      className={className ?? "h-[520px] w-full rounded-lg border border-slate-200 bg-white"}
    />
  );
}
