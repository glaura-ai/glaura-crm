import nodemailer from "nodemailer";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
};

export function defaultEmailFrom() {
  return process.env.SMTP_FROM || "Glaura <support@glaura.fr>";
}

export async function sendEmail({ to, subject, text, replyTo }: SendEmailInput) {
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
    auth: user && pass ? { user, pass } : undefined,
  });

  await transporter.sendMail({
    from: defaultEmailFrom(),
    to,
    subject,
    text,
    replyTo: replyTo || undefined,
  });
}
