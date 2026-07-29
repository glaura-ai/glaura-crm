/**
 * Onboarding welcome email ("Votre espace Glaura est prêt").
 *
 * Sent once, right after a salon account is created by
 * `createDisabledSalonAccount` — but ONLY when the account's login email is a
 * real one (does NOT end in `@glaura.fr`). The pipeline uses throwaway
 * `<slug>@glaura.fr` mailboxes for disabled skeletons; those must never be
 * emailed. A real address only appears when the job carries a `loginEmail`
 * override (P6 full onboarding), which is exactly when we want to hand the
 * salon their credentials + next steps.
 *
 * The markup is the `WELCOME_SALON` row of `EmailTemplate`, editable from
 * /modeles, with the bundled `templates/welcome-salon.html` as the fallback so a
 * missing, archived or unreachable row can never stop an onboarding email.
 *
 * The exports separate pure logic (testable without SMTP or a database) from
 * the impure orchestrator:
 *   - `shouldSendWelcomeEmail` — the gate (pure).
 *   - `bundledWelcomeTemplate` — the file fallback (pure).
 *   - `loadWelcomeTemplate`    — database row, else the file.
 *   - `renderWelcomeEmail`     — template substitution (pure).
 *   - `maybeSendWelcomeEmail`  — gate → load → render → send; never throws.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { onboardingValues, renderTemplate } from "@/lib/emailTemplates";
import { GLAURA_EMAIL_DOMAIN } from "./account-model";

// Derived from the single source of truth in account-model so the gate always
// matches the placeholder domain the pipeline actually mints logins under.
const INTERNAL_EMAIL_DOMAIN = `@${GLAURA_EMAIL_DOMAIN}`;

/** The `EmailTemplate.key` this email renders. Also used by the seed script. */
export const WELCOME_SALON_TEMPLATE_KEY = "WELCOME_SALON";

/** All URLs/support address are env-overridable; the defaults are the live prod values. */
function config() {
  return {
    proPortalUrl: process.env.GLAURA_PRO_PORTAL_URL?.trim() || "https://pro.glaura.ai",
    publicBaseUrl: (process.env.GLAURA_PUBLIC_BASE_URL?.trim() || "https://glaura.ai").replace(/\/+$/, ""),
    supportEmail: process.env.GLAURA_SUPPORT_EMAIL?.trim() || "support@glaura.fr",
    siteUrl: process.env.GLAURA_SITE_URL?.trim() || "https://glaura.ai",
    instagramUrl: process.env.GLAURA_INSTAGRAM_URL?.trim() || "https://www.instagram.com/glaura.app/",
    subject: process.env.GLAURA_WELCOME_EMAIL_SUBJECT?.trim() || "Votre espace Glaura est prêt 🎉",
  };
}

export type WelcomeTemplate = { subject: string; body: string; source: "database" | "file" };

// The file is read lazily on first use and cached — keeps this module
// import-safe (no disk I/O just to import it) and avoids re-reading per send.
let fileBodyCache: string | null = null;

/** The template shipped with the image: the fallback, and the seed source. */
export function bundledWelcomeTemplate(): WelcomeTemplate {
  if (fileBodyCache == null) {
    const path = fileURLToPath(new URL("./templates/welcome-salon.html", import.meta.url));
    fileBodyCache = readFileSync(path, "utf8");
  }
  return { subject: config().subject, body: fileBodyCache, source: "file" };
}

/**
 * The active `WELCOME_SALON` row, else the bundled file.
 *
 * Read per send rather than cached: sends are rare, and an edit in /modeles
 * should reach the very next salon rather than wait for a worker restart.
 */
export async function loadWelcomeTemplate(): Promise<WelcomeTemplate> {
  try {
    const row = await prisma.emailTemplate.findFirst({
      where: { key: WELCOME_SALON_TEMPLATE_KEY, archivedAt: null },
      select: { subject: true, body: true },
    });
    if (row?.body.trim()) return { subject: row.subject, body: row.body, source: "database" };
  } catch {
    // Database unreachable/migration pending — the onboarding email matters more
    // than editability, so fall through to the copy inside the image.
  }
  return bundledWelcomeTemplate();
}

export type WelcomeEmailVars = {
  email: string;
  password: string;
  /** userProfile.companyUserName (the public page slug). */
  companyUserName?: string | null;
  salonName?: string | null;
};

export type ShouldSendResult =
  | { send: true }
  | { send: false; reason: "no_email" | "internal_email" | "no_password" };

/**
 * The gate: only send to a real salon mailbox we have credentials for.
 * Pure — no I/O, fully unit-testable.
 */
export function shouldSendWelcomeEmail(email: string | null | undefined, password: string | null | undefined): ShouldSendResult {
  const trimmedEmail = (email ?? "").trim();
  if (!trimmedEmail) return { send: false, reason: "no_email" };
  if (trimmedEmail.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN)) return { send: false, reason: "internal_email" };
  if (!(password ?? "").trim()) return { send: false, reason: "no_password" };
  return { send: true };
}

export type RenderedEmail = { subject: string; html: string; text: string };

/** Public salon page for a slug — `{companyUserName}.glaura.ai`, else the site. */
export function salonPageUrl(companyUserName?: string | null): string {
  const cfg = config();
  const slug = (companyUserName ?? "").trim();
  const publicDomain = cfg.publicBaseUrl.replace(/^https?:\/\//, "");
  return slug ? `https://${slug}.${publicDomain}` : cfg.publicBaseUrl;
}

/** The `{{…}}` values this email resolves — shared with the /modeles preview. */
export function welcomeEmailValues(vars: WelcomeEmailVars): Record<string, string> {
  const cfg = config();
  return onboardingValues({
    loginEmail: vars.email,
    password: vars.password,
    pageUrl: salonPageUrl(vars.companyUserName),
    portalUrl: cfg.proPortalUrl,
    siteUrl: cfg.siteUrl,
    instagramUrl: cfg.instagramUrl,
    supportEmail: cfg.supportEmail,
  });
}

/**
 * Substitutes every `{{placeholder}}` in the template. Values are HTML-escaped
 * by the shared renderer, which also leaves unknown tokens alone. Pure — the
 * caller decides whether the template came from the database or the file.
 */
export function renderWelcomeEmail(vars: WelcomeEmailVars, template: WelcomeTemplate = bundledWelcomeTemplate()): RenderedEmail {
  const values = welcomeEmailValues(vars);
  const salon = { name: vars.salonName ?? "", contactName: null, bookingUrl: null };
  const html = renderTemplate(template.body, salon, { format: "HTML", values });

  const salonName = (vars.salonName ?? "").trim();
  const greeting = salonName ? `Bonjour ${salonName},` : "Bonjour,";
  const cfg = config();
  const text = [
    greeting,
    "",
    "Votre espace Glaura est prêt.",
    "",
    `Accédez à votre espace Pro : ${cfg.proPortalUrl}`,
    `Identifiant : ${vars.email}`,
    `Mot de passe : ${vars.password}`,
    "",
    `Votre page publique : ${salonPageUrl(vars.companyUserName)}`,
    "",
    `Besoin d'aide ? ${cfg.supportEmail}`,
    "",
    "— L'équipe Glaura",
  ].join("\n");

  return { subject: renderTemplate(template.subject, salon, { format: "TEXT", values }), html, text };
}

export type MaybeSendResult = { sent: boolean; skippedReason?: string; error?: string };

/**
 * Orchestrates gate → load → render → send. NEVER throws — onboarding must not
 * fail because a welcome email couldn't go out. The caller records the outcome
 * as a non-fatal warning / job-event field.
 */
export async function maybeSendWelcomeEmail(vars: WelcomeEmailVars): Promise<MaybeSendResult> {
  const gate = shouldSendWelcomeEmail(vars.email, vars.password);
  if (!gate.send) return { sent: false, skippedReason: gate.reason };

  try {
    const template = await loadWelcomeTemplate();
    const { subject, html, text } = renderWelcomeEmail(vars, template);
    await sendEmail({ to: vars.email.trim(), subject, text, html });
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}
