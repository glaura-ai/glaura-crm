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
 * The three exports separate pure logic (testable without SMTP) from the
 * impure orchestrator:
 *   - `shouldSendWelcomeEmail` — the gate (pure).
 *   - `renderWelcomeEmail`     — template substitution (pure).
 *   - `maybeSendWelcomeEmail`  — gate → render → send; never throws.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sendEmail } from "@/lib/email";
import { GLAURA_EMAIL_DOMAIN } from "./account-model";

// Derived from the single source of truth in account-model so the gate always
// matches the placeholder domain the pipeline actually mints logins under.
const INTERNAL_EMAIL_DOMAIN = `@${GLAURA_EMAIL_DOMAIN}`;

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

// Template is loaded lazily on first render and cached — keeps this module
// import-safe (no disk I/O just to import it) and avoids re-reading per send.
let templateCache: string | null = null;
function loadTemplate(): string {
  if (templateCache == null) {
    const path = fileURLToPath(new URL("./templates/welcome-salon.html", import.meta.url));
    templateCache = readFileSync(path, "utf8");
  }
  return templateCache;
}

/** Minimal HTML entity escaping for values interpolated into the email markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

/**
 * Substitutes every `{{placeholder}}` in the template. Dynamic user values
 * (email/password/salon name) are HTML-escaped; the URLs come from trusted
 * config. Pure — no I/O beyond the cached template read.
 */
export function renderWelcomeEmail(vars: WelcomeEmailVars): RenderedEmail {
  const cfg = config();
  const slug = (vars.companyUserName ?? "").trim();
  // Public salon page is served at the subdomain `{companyUserName}.glaura.ai`.
  // Raw URL for the plaintext part; HTML-escaped for the `href="..."` context
  // (the slug is the only untrusted segment — the caller slugifies it today,
  // but the renderer must not depend on that).
  const publicDomain = cfg.publicBaseUrl.replace(/^https?:\/\//, "");
  const pageUrl = slug ? `https://${slug}.${publicDomain}` : cfg.publicBaseUrl;
  const pageUrlHtml = escapeHtml(pageUrl);

  const replacements: Record<string, string> = {
    email_salon: escapeHtml(vars.email),
    mot_de_passe: escapeHtml(vars.password),
    lien_espace: cfg.proPortalUrl,
    lien_page: pageUrlHtml,
    lien_rdv: pageUrlHtml,
    lien_site: cfg.siteUrl,
    lien_instagram: cfg.instagramUrl,
    email_support: cfg.supportEmail,
  };

  const html = loadTemplate().replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in replacements ? replacements[key] : match,
  );

  const salonName = (vars.salonName ?? "").trim();
  const greeting = salonName ? `Bonjour ${salonName},` : "Bonjour,";
  const text = [
    greeting,
    "",
    "Votre espace Glaura est prêt.",
    "",
    `Accédez à votre espace Pro : ${cfg.proPortalUrl}`,
    `Identifiant : ${vars.email}`,
    `Mot de passe : ${vars.password}`,
    "",
    `Votre page publique : ${pageUrl}`,
    "",
    `Besoin d'aide ? ${cfg.supportEmail}`,
    "",
    "— L'équipe Glaura",
  ].join("\n");

  return { subject: cfg.subject, html, text };
}

export type MaybeSendResult = { sent: boolean; skippedReason?: string; error?: string };

/**
 * Orchestrates gate → render → send. NEVER throws — onboarding must not fail
 * because a welcome email couldn't go out. The caller records the outcome as a
 * non-fatal warning / job-event field.
 */
export async function maybeSendWelcomeEmail(vars: WelcomeEmailVars): Promise<MaybeSendResult> {
  const gate = shouldSendWelcomeEmail(vars.email, vars.password);
  if (!gate.send) return { sent: false, skippedReason: gate.reason };

  try {
    const { subject, html, text } = renderWelcomeEmail(vars);
    await sendEmail({ to: vars.email.trim(), subject, text, html });
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}
