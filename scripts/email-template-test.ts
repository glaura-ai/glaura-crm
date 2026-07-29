/**
 * Unit tests for the PURE email-template renderer (src/lib/emailTemplates.ts).
 *
 * Usage: npx tsx scripts/email-template-test.ts
 *
 * No test framework — plain assertions, exits non-zero on any failure so it can
 * gate CI. The renderer runs client-side for the live preview AND decides what a
 * rep actually sends, so the behaviours pinned here are the ones a template
 * author would notice: first-name handling, the empty-variable line rule, and
 * typo'd tokens staying visible instead of silently blanking.
 */

import {
  TEMPLATE_VARIABLES,
  onboardingValues,
  renderTemplate,
  unknownVariables,
  variablesForFormat,
  type EmailSalonDraftInput,
} from "../src/lib/emailTemplates";

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(label: string, actual: string, expected: string): void {
  check(label, actual === expected, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

const salon: EmailSalonDraftInput = {
  name: "BKMLAB.FR",
  contactName: "Marie Dupont",
  bookingUrl: "https://www.planity.com/bkmlab",
};

const bare: EmailSalonDraftInput = { name: "Studio D", contactName: null, bookingUrl: null };

// ---------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------

eq("{{salon}} is replaced with the salon name", renderTemplate("Glaura pour {{salon}}", salon), "Glaura pour BKMLAB.FR");
eq("{{contact}} uses the first name only", renderTemplate("Bonjour {{contact}},", salon), "Bonjour Marie,");
eq(
  "{{bookingUrl}} is replaced when present",
  renderTemplate("Votre page : {{bookingUrl}}", salon),
  "Votre page : https://www.planity.com/bkmlab",
);
eq(
  "the same variable can appear more than once",
  renderTemplate("{{salon}} — {{salon}}", salon),
  "BKMLAB.FR — BKMLAB.FR",
);

// Preserves buildEmailDraft's `firstName(contactName) || "bonjour"` fallback, so
// migrated templates read the same as the hardcoded ones did.
eq("{{contact}} falls back to 'bonjour' with no contact name", renderTemplate("Bonjour {{contact}},", bare), "Bonjour bonjour,");
eq(
  "{{contact}} falls back on a whitespace-only contact name",
  renderTemplate("Bonjour {{contact}},", { ...bare, contactName: "   " }),
  "Bonjour bonjour,",
);
eq(
  "{{contact}} trims surrounding whitespace before taking the first name",
  renderTemplate("Bonjour {{contact}},", { ...bare, contactName: "  Jean-Pierre Martin " }),
  "Bonjour Jean-Pierre,",
);

// ---------------------------------------------------------------------------
// Empty-variable line dropping
//
// Reproduces the old conditional booking paragraph: buildEmailDraft appended
// "\n\nJ'ai vu votre page…" ONLY when bookingUrl existed. A static template
// can't branch, so an empty variable takes its whole line with it.
// ---------------------------------------------------------------------------

const withBooking = "Bonjour,\n\nJ'ai vu votre page ici : {{bookingUrl}}\n\nBonne journée";

eq("a line with an empty variable is dropped entirely", renderTemplate(withBooking, bare), "Bonjour,\n\nBonne journée");
eq(
  "the same line survives intact when the variable resolves",
  renderTemplate(withBooking, salon),
  "Bonjour,\n\nJ'ai vu votre page ici : https://www.planity.com/bkmlab\n\nBonne journée",
);
eq(
  "dropping a line does not leave a triple newline behind",
  renderTemplate("A\n\n{{bookingUrl}}\n\nB", bare),
  "A\n\nB",
);
// One empty variable condemns the line even when a sibling resolved: the prose
// around it ("… pour {{salon}} ici : {{bookingUrl}}") is written for the case
// where the value exists, so keeping it would emit a dangling sentence.
eq(
  "one empty variable drops the line even if another on it resolved",
  renderTemplate("J'ai vu la page de {{salon}} ici : {{bookingUrl}}", bare),
  "",
);
eq(
  "that same line is kept when every variable resolves",
  renderTemplate("J'ai vu la page de {{salon}} ici : {{bookingUrl}}", salon),
  "J'ai vu la page de BKMLAB.FR ici : https://www.planity.com/bkmlab",
);
eq("a line with no variables is never dropped", renderTemplate("Bonne journée,\nL'équipe Glaura", bare), "Bonne journée,\nL'équipe Glaura");

// ---------------------------------------------------------------------------
// Unknown tokens
// ---------------------------------------------------------------------------

eq(
  "an unknown token is left literal so the typo is visible",
  renderTemplate("Bonjour {{prenom}},", salon),
  "Bonjour {{prenom}},",
);
eq(
  "an unknown token does not drop its line",
  renderTemplate("{{prenom}} chez {{salon}}", salon),
  "{{prenom}} chez BKMLAB.FR",
);

check(
  "unknownVariables reports only the unrecognised tokens",
  JSON.stringify(unknownVariables("{{prenom}} {{salon}} {{ville}}")) === JSON.stringify(["{{prenom}}", "{{ville}}"]),
);
check("unknownVariables returns nothing for a clean template", unknownVariables("{{salon}} {{contact}} {{bookingUrl}}").length === 0);
check("unknownVariables de-duplicates", unknownVariables("{{x}} {{x}}").length === 1);
check("unknownVariables handles a template with no tokens at all", unknownVariables("Bonjour").length === 0);

// An onboarding token in a plaintext relance has nothing to fill it, so the
// editor must flag it rather than let a rep email a literal {{mot_de_passe}}.
check("an onboarding token is unknown in a TEXT template", unknownVariables("{{mot_de_passe}}", "TEXT").length === 1);
check("an onboarding token is known in an HTML template", unknownVariables("{{mot_de_passe}}", "HTML").length === 0);

// Guards against the editor legend and the renderer drifting apart: every token
// advertised to authors must be one the renderer actually substitutes.
check(
  "every advertised variable is recognised in its own format",
  TEMPLATE_VARIABLES.every((variable) => unknownVariables(variable.token, "HTML").length === 0) &&
    variablesForFormat("TEXT").every((variable) => unknownVariables(variable.token, "TEXT").length === 0),
);
check("TEMPLATE_VARIABLES is non-empty and each entry has a label", TEMPLATE_VARIABLES.length > 0 && TEMPLATE_VARIABLES.every((v) => !!v.label));
check(
  "TEXT only advertises the salon variables",
  variablesForFormat("TEXT").every((variable) => variable.scope === "salon") &&
    variablesForFormat("HTML").length > variablesForFormat("TEXT").length,
);

// ---------------------------------------------------------------------------
// HTML format
//
// Markup is not line-oriented: dropping a "line" would delete a table row or an
// unclosed tag, and an unescaped value would break out of an href="…".
// ---------------------------------------------------------------------------

const account = onboardingValues({
  loginEmail: "contact@bkmlab.fr",
  password: "Gl4ura!x",
  pageUrl: "https://bkmlab.glaura.ai",
  portalUrl: "https://pro.glaura.ai",
  siteUrl: "https://glaura.ai",
  instagramUrl: "https://www.instagram.com/glaura.app/",
  supportEmail: "support@glaura.fr",
});
const html = { format: "HTML" as const, values: account };

eq(
  "HTML fills the onboarding placeholders",
  renderTemplate('<a href="{{lien_espace}}">{{email_salon}} / {{mot_de_passe}}</a>', salon, html),
  '<a href="https://pro.glaura.ai">contact@bkmlab.fr / Gl4ura!x</a>',
);
eq(
  "HTML never drops a line, even when a variable is empty",
  renderTemplate("<tr>\n<td>{{bookingUrl}}</td>\n</tr>", bare, html),
  "<tr>\n<td></td>\n</tr>",
);
eq(
  "HTML escapes interpolated values",
  renderTemplate("<td>{{salon}}</td>", { ...bare, name: 'A & B <script>"x"' }, html),
  "<td>A &amp; B &lt;script&gt;&quot;x&quot;</td>",
);
eq(
  "HTML leaves an unknown token literal too",
  renderTemplate("<td>{{prenom}}</td>", salon, html),
  "<td>{{prenom}}</td>",
);
eq(
  "TEXT does not escape — a plaintext relance is not markup",
  renderTemplate("{{salon}}", { ...bare, name: "A & B" }),
  "A & B",
);
check(
  "onboardingValues maps the page URL onto both link tokens",
  account["{{lien_page}}"] === "https://bkmlab.glaura.ai" && account["{{lien_rdv}}"] === "https://bkmlab.glaura.ai",
);

console.log("");
if (failures > 0) {
  console.error(`${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("All tests passed.");
}
