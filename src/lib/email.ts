import nodemailer from "nodemailer";
import {
  GLAURA_LOGO_CID,
  GLAURA_LOGO_FILENAME,
  GLAURA_LOGO_PNG_BASE64,
} from "@/lib/email-assets/glaura-logo";
import { inlineEmailImages } from "@/lib/email-inline-images";

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

/**
 * Ships the logo as an inline part whenever the markup points at it.
 *
 * Done here rather than at each call site so the invariant "an HTML body that
 * references `cid:glaura-logo` always carries that part" cannot be forgotten by
 * a new sender — a missing part renders as the same broken icon a blocked
 * remote image does.
 */
function logoAttachment(html: string) {
  if (!html.includes(`cid:${GLAURA_LOGO_CID}`)) return [];
  return [
    {
      filename: GLAURA_LOGO_FILENAME,
      content: Buffer.from(GLAURA_LOGO_PNG_BASE64, "base64"),
      contentType: "image/png",
      cid: GLAURA_LOGO_CID,
      contentDisposition: "inline" as const,
    },
  ];
}

/**
 * Every image the message can carry itself, carried: the logo, plus whatever
 * `inlineEmailImages` could resolve out of the body. Templates are pasted by
 * operators, so this is the difference between "the images happen to render"
 * and "the images render".
 */
async function buildBody(html?: string | null) {
  if (!html) return { html: undefined, attachments: undefined };

  const inlined = await inlineEmailImages(html);
  const attachments = [...logoAttachment(inlined.html), ...inlined.attachments];
  return { html: inlined.html, attachments: attachments.length ? attachments : undefined };
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

  const body = await buildBody(html);

  await transporter.sendMail({
    from: defaultEmailFrom(),
    to,
    subject,
    text,
    html: body.html,
    replyTo: replyTo || undefined,
    attachments: body.attachments,
  });
}
