import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { escapeHtml, renderTemplate } from "@/lib/emailTemplates";
import type { CatalogFeature } from "./catalog";

export const DEFAULT_SUBJECT = "3 nouveautés pour remplir votre agenda";
const PREHEADER = "Découvrez les dernières nouveautés de votre espace Glaura.";
const SUPPORT_LINE = "Une question ? Répondez simplement à cet email.";
const UNSUBSCRIBE_LABEL = "Ne plus recevoir les nouveautés";
const CTA = "Essayer";

export type RenderDigestInput = {
  edition: string;
  salonName: string;
  features: readonly CatalogFeature[];
  portalBaseUrl: string;
  unsubscribeUrl: string;
  subject?: string;
};

let templateCache: string | null = null;
function template(): string {
  templateCache ??= readFileSync(
    fileURLToPath(new URL("../onboarding/templates/feature-digest.html", import.meta.url)),
    "utf8",
  );
  return templateCache;
}

/** Escapes, and defuses `{{…}}` so catalog text can never act as a template token. */
function safe(value: string): string {
  return escapeHtml(value).replace(/\{\{/g, "&#123;&#123;");
}

function featureUrl(portalBaseUrl: string, id: string): string {
  return `${portalBaseUrl}/nouveautes#${encodeURIComponent(id)}`;
}

function featureBlock(f: CatalogFeature, url: string): string {
  return `<tr><td class="pad" style="padding:28px 42px 0;">
  <a href="${safe(url)}" style="text-decoration:none;"><img src="${safe(f.emailImage)}" width="516" alt="${safe(f.titleFr)}" style="display:block;width:100%;max-width:516px;height:auto;border:0;border-radius:14px;"></a>
  <div style="padding-top:16px;font-family:Georgia,serif;font-size:22px;line-height:28px;font-weight:700;color:#1A2B4A;">${safe(f.titleFr)}</div>
  <div style="padding-top:8px;font-family:Arial,sans-serif;font-size:16px;line-height:25px;color:#6A6560;">${safe(f.benefitFr)}</div>
  <div style="padding-top:14px;"><a href="${safe(url)}" style="display:inline-block;background:#D92D58;color:#FFFFFF;text-decoration:none;border-radius:14px;padding:12px 22px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;">${CTA}</a></div>
</td></tr>`;
}

export function renderDigest(input: RenderDigestInput): { subject: string; html: string; text: string } {
  const salonName = input.salonName.trim();
  const intro = `${salonName ? `Bonjour ${salonName}` : "Bonjour"}, voici ce qui a changé ce mois-ci dans votre espace Glaura.`;
  const blocks = input.features
    .map((f) => featureBlock(f, featureUrl(input.portalBaseUrl, f.id)))
    .join("\n");

  const html = renderTemplate(
    template().replace("{{featureBlocks}}", blocks),
    { name: salonName },
    {
      format: "HTML",
      values: {
        "{{intro}}": intro,
        "{{preheader}}": PREHEADER,
        "{{unsubscribeUrl}}": input.unsubscribeUrl,
        "{{supportLine}}": SUPPORT_LINE,
        "{{unsubscribeLabel}}": UNSUBSCRIBE_LABEL,
      },
    },
  );

  const text = [
    intro,
    "",
    ...input.features.flatMap((f) => [
      f.titleFr,
      f.benefitFr,
      `${CTA} : ${featureUrl(input.portalBaseUrl, f.id)}`,
      "",
    ]),
    SUPPORT_LINE,
    "L’équipe Glaura",
    "",
    `${UNSUBSCRIBE_LABEL} : ${input.unsubscribeUrl}`,
  ].join("\n");

  return { subject: input.subject?.trim() || DEFAULT_SUBJECT, html, text };
}
