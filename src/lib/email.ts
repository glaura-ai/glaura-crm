import nodemailer from "nodemailer";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML body. When set, `text` is kept as the plaintext fallback. */
  html?: string | null;
  replyTo?: string | null;
};

export function defaultEmailFrom() {
  return process.env.SMTP_FROM || "Glaura <support@glaura.fr>";
}

export async function sendEmail({ to, subject, text, html, replyTo }: SendEmailInput) {
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST manquant");

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    // EHLO must present a FQDN: on the VPS (Docker `--network host`) the default
    // is the bare host name (e.g. `ubuntu-4gb-hel1-1`), which smtp-relay.gmail.com
    // rejects with `421 4.7.0 ... (EHLO)`. A real hostname makes the relay accept.
    name: process.env.SMTP_EHLO_NAME || "glaura.ai",
    auth: user && pass ? { user, pass } : undefined,
    // Bound every stage so a slow/hung relay fails fast instead of stalling the
    // (sequential) job workers — nodemailer's defaults are ~minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  await transporter.sendMail({
    from: defaultEmailFrom(),
    to,
    subject,
    text,
    html: html || undefined,
    replyTo: replyTo || undefined,
  });
}
