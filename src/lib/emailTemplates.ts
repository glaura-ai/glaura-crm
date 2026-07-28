/**
 * PURE rendering for the salon follow-up email templates.
 *
 * Templates themselves live in the database (model `EmailTemplate`) and are
 * edited from /modeles. This module only knows how to turn one into a concrete
 * draft, and stays free of Prisma/React so it can run in the browser for the
 * live preview and be unit-tested without mocks
 * (scripts/email-template-test.ts).
 */

export type EmailSalonDraftInput = {
  name: string;
  contactName?: string | null;
  bookingUrl?: string | null;
};

export interface TemplateVariable {
  /** The literal token an author types, e.g. `{{salon}}`. */
  token: string;
  label: string;
  /** Shown in the editor legend under the label. */
  hint?: string;
}

/**
 * The variables an author may use. This is the single source for both the
 * editor legend and `unknownVariables`, so what we advertise and what we
 * substitute cannot drift.
 */
export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { token: "{{salon}}", label: "Nom du salon" },
  { token: "{{contact}}", label: "Prénom du contact", hint: "« bonjour » si le contact est inconnu" },
  { token: "{{bookingUrl}}", label: "URL de réservation", hint: "la ligne entière disparaît si le salon n'en a pas" },
] as const;

/** Matches any `{{token}}`, known or not, so typos can be reported. */
const TOKEN_PATTERN = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g;

function resolveValues(salon: EmailSalonDraftInput): Record<string, string> {
  return {
    "{{salon}}": salon.name?.trim() ?? "",
    // Mirrors the pre-database behaviour: first name only, and a neutral
    // greeting rather than an awkward "Bonjour ," when we have no contact.
    "{{contact}}": firstName(salon.contactName) || "bonjour",
    "{{bookingUrl}}": salon.bookingUrl?.trim() ?? "",
  };
}

/** Normalises `{{ salon }}` to `{{salon}}` so spacing inside braces is forgiven. */
function canonicalToken(token: string): string {
  return token.replace(/\s+/g, "");
}

/**
 * Renders a subject or body against one salon.
 *
 * Unknown tokens are deliberately left untouched: a template author who typed
 * `{{prenom}}` should see it in the preview rather than get a silent blank.
 *
 * A line containing a KNOWN variable that resolves to empty is dropped whole.
 * That is what reproduces the old conditional booking-URL paragraph, which was
 * only appended when the salon had a booking page — a static template cannot
 * branch, so the empty variable takes its line with it.
 */
export function renderTemplate(text: string, salon: EmailSalonDraftInput): string {
  const values = resolveValues(salon);

  const kept = text.split("\n").filter((line) => !hasEmptyKnownVariable(line, values));

  return kept
    .map((line) => line.replace(TOKEN_PATTERN, (token) => values[canonicalToken(token)] ?? token))
    .join("\n")
    // Dropping a line between two paragraphs would otherwise leave a wider gap
    // than the author wrote.
    .replace(/\n{3,}/g, "\n\n");
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
 * Tokens used in `text` that the renderer does not know about — surfaced in the
 * editor as a warning so a typo is caught before anything is sent.
 */
export function unknownVariables(text: string): string[] {
  const known = new Set(TEMPLATE_VARIABLES.map((variable) => variable.token));
  const found = text.match(TOKEN_PATTERN) ?? [];
  return Array.from(new Set(found.map(canonicalToken))).filter((token) => !known.has(token));
}

function firstName(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}
