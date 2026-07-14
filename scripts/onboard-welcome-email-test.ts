/**
 * Unit tests for the onboarding welcome email (gate + template render).
 * Plain assertions, no framework — exits non-zero on any failure. No SMTP:
 * only the two pure functions are exercised.
 *
 * Usage: npx tsx scripts/onboard-welcome-email-test.ts
 */

import { shouldSendWelcomeEmail, renderWelcomeEmail } from "../src/lib/onboarding/welcome-email";

let failures = 0;
function check(label: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures += 1;
}

// ---------------------------------------------------------------------------
// 1. shouldSendWelcomeEmail — the gate
// ---------------------------------------------------------------------------

check("internal @glaura.fr → skip", (() => {
  const r = shouldSendWelcomeEmail("maison-irisee@glaura.fr", "pw");
  return !r.send && r.reason === "internal_email";
})());

check("internal @GLAURA.FR (case-insensitive) → skip", (() => {
  const r = shouldSendWelcomeEmail("X@GLAURA.FR", "pw");
  return !r.send && r.reason === "internal_email";
})());

check("real email + no password → skip (no_password)", (() => {
  const r = shouldSendWelcomeEmail("iris.mng@icloud.com", "");
  return !r.send && r.reason === "no_password";
})());

check("empty email → skip (no_email)", (() => {
  const r = shouldSendWelcomeEmail("", "pw");
  return !r.send && r.reason === "no_email";
})());

check("real email + password → send", shouldSendWelcomeEmail("iris.mng@icloud.com", "Glaura123").send === true);

// ---------------------------------------------------------------------------
// 2. renderWelcomeEmail — template substitution
// ---------------------------------------------------------------------------

const rendered = renderWelcomeEmail({
  email: "iris.mng@icloud.com",
  password: 'p&ss"<x>',
  companyUserName: "maison-irisee",
  salonName: "Maison Irisée",
});

check("no unreplaced {{placeholders}} remain", !/\{\{\s*\w+\s*\}\}/.test(rendered.html),
  (rendered.html.match(/\{\{\s*\w+\s*\}\}/g) || []).join(","));

check("email appears in html", rendered.html.includes("iris.mng@icloud.com"));

check("password is HTML-escaped (no raw <x>)", rendered.html.includes("p&amp;ss&quot;&lt;x&gt;") && !rendered.html.includes('p&ss"<x>'));

check("lien_espace = pro portal", rendered.html.includes("https://pro.glaura.ai"));

check("lien_page = {slug}.glaura.ai subdomain", rendered.html.includes("https://maison-irisee.glaura.ai"));

check("instagram = glaura.app handle", rendered.html.includes("https://www.instagram.com/glaura.app/"));

check("no LinkedIn link", !/linkedin/i.test(rendered.html));

check("email_support present", rendered.html.includes("support@glaura.fr"));

check("subject set", rendered.subject.length > 0 && rendered.subject.includes("Glaura"));

check("plaintext fallback carries creds + portal", (() => {
  const t = rendered.text;
  return t.includes("iris.mng@icloud.com") && t.includes('p&ss"<x>') && t.includes("https://pro.glaura.ai");
})());

// Defensive: a malformed slug must be HTML-escaped so it can't break out of the href attribute.
const evilSlug = renderWelcomeEmail({ email: "x@example.com", password: "pw", companyUserName: '"><script>x', salonName: "" });
check("malformed slug is escaped (no attribute breakout)",
  !evilSlug.html.includes('"><script>') && evilSlug.html.includes("&quot;&gt;&lt;script&gt;"));

// Slug-less render should not emit a trailing slash page URL.
const noSlug = renderWelcomeEmail({ email: "x@example.com", password: "pw", companyUserName: "", salonName: "" });
check("no slug → page url is the bare base (no trailing slash)",
  noSlug.html.includes("https://glaura.ai") && !noSlug.html.includes("https://glaura.ai//"));

// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
