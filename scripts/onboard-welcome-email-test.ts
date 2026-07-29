/**
 * Unit tests for the onboarding welcome email (gate + template render).
 * Plain assertions, no framework — exits non-zero on any failure. No SMTP:
 * only the two pure functions are exercised.
 *
 * Usage: npx tsx scripts/onboard-welcome-email-test.ts
 */

import {
  bundledWelcomeTemplate,
  shouldSendWelcomeEmail,
  renderWelcomeEmail,
} from "../src/lib/onboarding/welcome-email";
import { GLAURA_LOGO_CID, GLAURA_LOGO_PNG_BASE64 } from "../src/lib/email-assets/glaura-logo";

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
// 3. The logo travels with the message
//
// A remote <img> is a fetch the client may refuse — which is how salons ended
// up looking at a broken image. src/lib/email.ts attaches the inline part
// whenever the markup references this cid, so the reference must survive.
// ---------------------------------------------------------------------------

check("both logos reference the inline cid", rendered.html.split(`cid:${GLAURA_LOGO_CID}`).length - 1 === 2);
check("no remote image URL is left in the template", !/<img[^>]+src="https?:/i.test(rendered.html));

// The part is only worth attaching if it is a real PNG: a truncated or
// re-encoded constant would render as the same broken icon it replaces.
const logo = Buffer.from(GLAURA_LOGO_PNG_BASE64, "base64");
check(
  "the inlined asset decodes to a PNG of a sane size",
  logo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    logo.length > 1000 &&
    logo.length < 30_000,
  `${logo.length} bytes`,
);

// ---------------------------------------------------------------------------
// 4. Template source
//
// The live body comes from the WELCOME_SALON row in the database (loaded by
// loadWelcomeTemplate, which needs a connection and is therefore exercised on a
// real environment, not here). What is pinned here: the bundled file is a valid
// fallback, and an arbitrary template — i.e. an edited row — is what actually
// gets rendered when one is passed.
// ---------------------------------------------------------------------------

const bundled = bundledWelcomeTemplate();
check("bundled template is the file, with a subject", bundled.source === "file" && bundled.body.length > 1000 && bundled.subject.length > 0);

const edited = renderWelcomeEmail(
  { email: "x@example.com", password: "pw", companyUserName: "studio-d", salonName: "Studio D" },
  { subject: "Objet édité", body: "<p>{{email_salon}} — {{mot_de_passe}}</p>", source: "database" },
);
check("an edited template body is what gets rendered", edited.html === "<p>x@example.com — pw</p>");
check("an edited subject is used", edited.subject === "Objet édité");
check("the plaintext part is built independently of the body", edited.text.includes("Mot de passe : pw"));

// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
