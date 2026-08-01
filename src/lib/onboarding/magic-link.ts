/**
 * Passwordless magic sign-in link for the self-serve form flow.
 *
 * When a job carries `magicLinkSignIn`, the create path skips the
 * plaintext-password welcome email and instead:
 *   1. mints a single-use, expiring token in Firestore `signInTokens/{token}`,
 *   2. emails an "Accéder à mon salon" link → {portal}/bienvenue?t={token}.
 *
 * The portal's /api/onboarding/magic-signin exchanges that token for a Firebase
 * custom token, so no password ever travels by email. Pure render/gate logic is
 * split from the impure orchestrator for testability. See doc 32.
 */

import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import { sendEmail } from "@/lib/email";
import { GLAURA_EMAIL_DOMAIN } from "./account-model";

const INTERNAL_EMAIL_DOMAIN = `@${GLAURA_EMAIL_DOMAIN}`;
/** Sign-in tokens are valid for a week — long enough for a salon to act on the email. */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function config() {
  return {
    proPortalUrl: (process.env.GLAURA_PRO_PORTAL_URL?.trim() || "https://pro.glaura.ai").replace(/\/+$/, ""),
    supportEmail: process.env.GLAURA_SUPPORT_EMAIL?.trim() || "support@glaura.fr",
    subject: process.env.GLAURA_MAGIC_EMAIL_SUBJECT?.trim() || "Votre espace Glaura est prêt 🎉",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The gate: only email a real salon mailbox. The pipeline mints throwaway
 * `<slug>@glaura.fr` logins for disabled skeletons; those must never be emailed.
 */
export type ShouldSendResult = { send: true } | { send: false; reason: "no_email" | "internal_email" };
export function shouldSendMagicLink(email: string | null | undefined): ShouldSendResult {
  const trimmed = (email ?? "").trim();
  if (!trimmed) return { send: false, reason: "no_email" };
  if (trimmed.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN)) return { send: false, reason: "internal_email" };
  return { send: true };
}

/** Opaque, URL-safe single-use token (256 bits of entropy). */
export function generateSignInToken(): string {
  return randomBytes(32).toString("hex");
}

export type RenderedEmail = { subject: string; html: string; text: string };

/** Renders the passwordless welcome email around a ready-made magic link. */
export function renderMagicLinkEmail(vars: { salonName?: string | null; magicLink: string }): RenderedEmail {
  const cfg = config();
  const linkHtml = escapeHtml(vars.magicLink);
  const salonName = (vars.salonName ?? "").trim();
  const greeting = salonName ? `Bonjour ${escapeHtml(salonName)},` : "Bonjour,";
  const greetingText = salonName ? `Bonjour ${salonName},` : "Bonjour,";

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f7f8fa;font-family:'DM Sans',Arial,sans-serif;color:#141018;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:18px;padding:36px 32px;box-shadow:0 10px 34px rgba(20,10,20,.06);">
        <tr><td>
          <p style="font-size:15px;margin:0 0 8px;">${greeting}</p>
          <h1 style="font-size:24px;font-weight:800;letter-spacing:-.01em;margin:0 0 12px;">Votre espace Glaura est prêt 🎉</h1>
          <p style="font-size:15px;line-height:1.5;color:#4a4650;margin:0 0 28px;">Nous avons préparé votre salon. Cliquez ci-dessous pour accéder à votre espace — aucun mot de passe à retenir.</p>
          <a href="${linkHtml}" style="display:inline-block;background:#E50050;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:12px;">Accéder à mon salon →</a>
          <p style="font-size:13px;color:#8a8590;margin:28px 0 0;">Ce lien est valable 7 jours et à usage unique. Une fois connectée, vous pourrez définir un mot de passe dans <strong>Paramètres&nbsp;→&nbsp;Profil</strong> pour vous reconnecter librement. Besoin d'aide ? <a href="mailto:${escapeHtml(cfg.supportEmail)}" style="color:#E50050;">${escapeHtml(cfg.supportEmail)}</a></p>
        </td></tr>
      </table>
      <p style="font-size:12px;color:#b1acb4;margin:20px 0 0;">— L'équipe Glaura</p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    greetingText,
    "",
    "Votre espace Glaura est prêt.",
    "",
    `Accédez à votre espace (aucun mot de passe) : ${vars.magicLink}`,
    "",
    "Ce lien est valable 7 jours et à usage unique.",
    "Une fois connectée, définissez un mot de passe dans Paramètres → Profil pour vous reconnecter librement.",
    `Besoin d'aide ? ${cfg.supportEmail}`,
    "",
    "— L'équipe Glaura",
  ].join("\n");

  return { subject: cfg.subject, html, text };
}

/** Mints a single-use sign-in token for `uid` and returns the /bienvenue URL. */
export async function issueMagicSignInLink(uid: string, email: string, salonName: string | null): Promise<string> {
  const token = generateSignInToken();
  const now = Date.now();
  await getDb()
    .collection("signInTokens")
    .doc(token)
    .set({
      uid,
      email,
      salonName: salonName ?? null,
      used: false,
      createdAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + TOKEN_TTL_MS),
    });
  return `${config().proPortalUrl}/bienvenue?t=${token}`;
}

export type MaybeSendResult = { sent: boolean; skippedReason?: string; error?: string };

/**
 * Orchestrates gate → issue token → render → send. NEVER throws — onboarding
 * must not fail because the email couldn't go out; the caller logs a warning.
 */
export async function maybeSendMagicLinkEmail(vars: {
  uid: string;
  email: string;
  salonName?: string | null;
}): Promise<MaybeSendResult> {
  const gate = shouldSendMagicLink(vars.email);
  if (!gate.send) return { sent: false, skippedReason: gate.reason };

  try {
    const magicLink = await issueMagicSignInLink(vars.uid, vars.email.trim(), vars.salonName ?? null);
    const { subject, html, text } = renderMagicLinkEmail({ salonName: vars.salonName, magicLink });
    await sendEmail({ to: vars.email.trim(), subject, text, html });
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}
