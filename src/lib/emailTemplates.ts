/**
 * PURE rendering for the salon email templates.
 *
 * Templates themselves live in the database (model `EmailTemplate`) and are
 * edited from /modeles. This module only knows how to turn one into a concrete
 * draft, and stays free of Prisma/React so it can run in the browser for the
 * live preview and be unit-tested without mocks
 * (scripts/email-template-test.ts).
 *
 * Two formats share this renderer:
 *   - TEXT — the prospection copy. Line-oriented: a line whose variable comes
 *     out empty disappears with it.
 *   - HTML — the onboarding « Compte prêt » email. Markup is not line-oriented,
 *     so nothing is ever dropped, and every interpolated value is escaped
 *     because it lands inside tags and `href="…"` attributes.
 */

export type EmailFormat = "TEXT" | "HTML";

export type EmailSalonDraftInput = {
  name: string;
  contactName?: string | null;
  bookingUrl?: string | null;
};

/**
 * The onboarding placeholders. Resolved from the account the pipeline created
 * (credentials) plus deployment config (links), by `onboardingValues`.
 */
export type EmailOnboardingInput = {
  /** The salon's login — `userProfile.email`, not the CRM contact address. */
  loginEmail: string;
  password: string;
  /** Public salon page, `{companyUserName}.glaura.ai`. */
  pageUrl: string;
  portalUrl: string;
  siteUrl: string;
  instagramUrl: string;
  supportEmail: string;
};

export interface TemplateVariable {
  /** The literal token an author types, e.g. `{{salon}}`. */
  token: string;
  label: string;
  /** Shown in the editor legend under the label. */
  hint?: string;
  /**
   * `salon` variables work in every template; `onboarding` ones only make sense
   * on the HTML account emails, where the credentials and links exist, and
   * `transactional` ones on the HTML emails sent to a customer about one
   * booking.
   */
  scope: "salon" | "onboarding" | "transactional";
}

/**
 * The variables an author may use. This is the single source for both the
 * editor legend and `unknownVariables`, so what we advertise and what we
 * substitute cannot drift.
 */
export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { token: "{{salon}}", label: "Nom du salon", scope: "salon" },
  { token: "{{contact}}", label: "Prénom du contact", hint: "« bonjour » si le contact est inconnu", scope: "salon" },
  { token: "{{bookingUrl}}", label: "URL de réservation", hint: "la ligne entière disparaît si le salon n'en a pas", scope: "salon" },
  { token: "{{email_salon}}", label: "Identifiant du compte", hint: "l'email de connexion créé par l'onboarding", scope: "onboarding" },
  { token: "{{mot_de_passe}}", label: "Mot de passe", scope: "onboarding" },
  { token: "{{lien_espace}}", label: "Lien espace Pro", scope: "onboarding" },
  { token: "{{lien_page}}", label: "Lien page publique", scope: "onboarding" },
  { token: "{{lien_rdv}}", label: "Lien prise de rendez-vous", scope: "onboarding" },
  { token: "{{lien_site}}", label: "Lien site Glaura", scope: "onboarding" },
  { token: "{{lien_instagram}}", label: "Lien Instagram Glaura", scope: "onboarding" },
  { token: "{{email_support}}", label: "Email support", scope: "onboarding" },
  { token: "{{lien_apercu}}", label: "Lien vers l’aperçu /pro", scope: "onboarding" },
  { token: "{{lien_connexion}}", label: "Lien de connexion à usage unique", scope: "onboarding" },
  { token: "{{nombre_prestations}}", label: "Nombre de prestations importées", scope: "onboarding" },
  { token: "{{instagram_salon}}", label: "Compte Instagram vérifié", scope: "onboarding" },
  { token: "{{image_salon}}", label: "Photo principale du salon", scope: "onboarding" },
  { token: "{{adresse_salon}}", label: "Adresse du salon", scope: "onboarding" },
  { token: "{{prestation_1}}", label: "Première prestation", scope: "onboarding" },
  { token: "{{prix_prestation_1}}", label: "Prix de la première prestation", scope: "onboarding" },
  { token: "{{duree_prestation_1}}", label: "Durée de la première prestation", scope: "onboarding" },
  { token: "{{prestation_2}}", label: "Deuxième prestation", scope: "onboarding" },
  { token: "{{prix_prestation_2}}", label: "Prix de la deuxième prestation", scope: "onboarding" },
  { token: "{{duree_prestation_2}}", label: "Durée de la deuxième prestation", scope: "onboarding" },
  { token: "{{prestation_3}}", label: "Troisième prestation", scope: "onboarding" },
  { token: "{{prix_prestation_3}}", label: "Prix de la troisième prestation", scope: "onboarding" },
  { token: "{{duree_prestation_3}}", label: "Durée de la troisième prestation", scope: "onboarding" },
  { token: "{{customerName}}", label: "Prénom du client", hint: "porte son espace : écrire « Bonjour{{customerName}}, »", scope: "transactional" },
  { token: "{{salonName}}", label: "Salon du rendez-vous", scope: "transactional" },
  { token: "{{serviceName}}", label: "Prestation réservée", scope: "transactional" },
  { token: "{{bookingDate}}", label: "Date du rendez-vous", scope: "transactional" },
  { token: "{{bookingTime}}", label: "Heure du rendez-vous", scope: "transactional" },
  { token: "{{refundAmountEuros}}", label: "Montant remboursé", hint: "en euros, sans le symbole", scope: "transactional" },
  { token: "{{trialEndDate}}", label: "Date de fin d’essai", scope: "transactional" },
  { token: "{{planName}}", label: "Nom de l’abonnement", scope: "transactional" },
  { token: "{{billingUrl}}", label: "Lien de gestion de l’abonnement", scope: "transactional" },
] as const;

/** Matches any `{{token}}`, known or not, so typos can be reported. */
const TOKEN_PATTERN = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g;

/** The variables offered — and accepted — for a given format. */
export function variablesForFormat(format: EmailFormat): readonly TemplateVariable[] {
  return format === "HTML" ? TEMPLATE_VARIABLES : TEMPLATE_VARIABLES.filter((variable) => variable.scope === "salon");
}

/** Minimal HTML entity escaping for values interpolated into email markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function salonValues(salon: EmailSalonDraftInput): Record<string, string> {
  return {
    "{{salon}}": salon.name?.trim() ?? "",
    // Mirrors the pre-database behaviour: first name only, and a neutral
    // greeting rather than an awkward "Bonjour ," when we have no contact.
    "{{contact}}": firstName(salon.contactName) || "bonjour",
    "{{bookingUrl}}": salon.bookingUrl?.trim() ?? "",
  };
}

/** Token map for the onboarding placeholders, for both the worker and /modeles. */
export function onboardingValues(input: EmailOnboardingInput): Record<string, string> {
  return {
    "{{email_salon}}": input.loginEmail,
    "{{mot_de_passe}}": input.password,
    "{{lien_espace}}": input.portalUrl,
    "{{lien_page}}": input.pageUrl,
    "{{lien_rdv}}": input.pageUrl,
    "{{lien_site}}": input.siteUrl,
    "{{lien_instagram}}": input.instagramUrl,
    "{{email_support}}": input.supportEmail,
  };
}

export type RenderOptions = {
  format?: EmailFormat;
  /** Extra token → value pairs, e.g. `onboardingValues(…)`. */
  values?: Record<string, string>;
};

/**
 * Renders a subject or body against one salon.
 *
 * Unknown tokens are deliberately left untouched: a template author who typed
 * `{{prenom}}` should see it in the preview rather than get a silent blank.
 *
 * In TEXT, a line containing a KNOWN variable that resolves to empty is dropped
 * whole. That is what reproduces the old conditional booking-URL paragraph,
 * which was only appended when the salon had a booking page — a static template
 * cannot branch, so the empty variable takes its line with it. HTML never drops
 * anything: a line there is markup, not a sentence.
 */
export function renderTemplate(text: string, salon: EmailSalonDraftInput, options: RenderOptions = {}): string {
  const format = options.format ?? "TEXT";
  const values = { ...salonValues(salon), ...options.values };
  const substitute = (line: string) =>
    line.replace(TOKEN_PATTERN, (token) => {
      const value = values[canonicalToken(token)];
      if (value === undefined) return token;
      return format === "HTML" ? escapeHtml(value) : value;
    });

  if (format === "HTML") return text.split("\n").map(substitute).join("\n");

  return text
    .split("\n")
    .filter((line) => !hasEmptyKnownVariable(line, values))
    .map(substitute)
    .join("\n")
    // Dropping a line between two paragraphs would otherwise leave a wider gap
    // than the author wrote.
    .replace(/\n{3,}/g, "\n\n");
}

/** Normalises `{{ salon }}` to `{{salon}}` so spacing inside braces is forgiven. */
function canonicalToken(token: string): string {
  return token.replace(/\s+/g, "");
}

function hasEmptyKnownVariable(line: string, values: Record<string, string>): boolean {
  const tokens = line.match(TOKEN_PATTERN);
  if (!tokens) return false;
  return tokens.some((token) => {
    const value = values[canonicalToken(token)];
    return value !== undefined && value === "";
  });
}

/**
 * Tokens used in `text` that this format does not know about — surfaced in the
 * editor as a warning so a typo is caught before anything is sent. An
 * onboarding token in a TEXT template counts as unknown: nothing would fill it.
 */
export function unknownVariables(text: string, format: EmailFormat = "TEXT"): string[] {
  const known = new Set(variablesForFormat(format).map((variable) => variable.token));
  const found = text.match(TOKEN_PATTERN) ?? [];
  return Array.from(new Set(found.map(canonicalToken))).filter((token) => !known.has(token));
}

function firstName(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}
