/**
 * Transactional « réservation remboursée » email.
 *
 * Sent to the CUSTOMER (not the salon) after an admin refunds a booking in the
 * Glaura back-office: the appointment could not be honoured, the deposit went
 * back. Cloud Functions POSTs to /api/transactional/booking-refund, which
 * renders this template and queues an `EmailJob` — the CRM worker owns the SMTP
 * relay, so the refund path never opens its own connection and a relay outage
 * retries here instead of failing the refund.
 *
 * Markup is the `BOOKING_REFUND` row of `EmailTemplate`, editable from
 * /modeles, with the bundled `booking-refund.html` as the fallback so a missing
 * or archived row can never swallow a refund notice. Mirrors
 * `onboarding/pro-preview.ts`, which resolves its template the same way.
 *
 * Exports split pure logic from I/O:
 *   - `bookingRefundRequestSchema` — the wire contract (pure).
 *   - `bundledBookingRefundTemplate` — the file fallback (pure).
 *   - `loadBookingRefundTemplate`    — database row, else the file.
 *   - `renderBookingRefundEmail`     — token substitution (pure).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { renderTemplate } from "@/lib/emailTemplates";

/** The `EmailTemplate.key` this email renders. Also used by the seed script. */
export const BOOKING_REFUND_TEMPLATE_KEY = "BOOKING_REFUND";

export const BOOKING_REFUND_SUBJECT = "Votre réservation a été annulée et remboursée";

export const bookingRefundDataSchema = z.object({
  /** Empty is allowed — the greeting falls back to a bare « Bonjour, ». */
  customerName: z.string().trim().max(120),
  salonName: z.string().trim().min(1).max(190),
  serviceName: z.string().trim().min(1).max(190),
  /** Already formatted by the caller, e.g. « lundi 10 août 2026 ». */
  bookingDate: z.string().trim().min(1).max(60),
  /** Already formatted by the caller, e.g. « 14:30 ». */
  bookingTime: z.string().trim().min(1).max(20),
  /** Euros, not cents: what the customer sees on their statement. */
  refundAmountEuros: z.number().nonnegative().finite(),
});

export const bookingRefundRequestSchema = z.object({
  to: z.email(),
  data: bookingRefundDataSchema,
});

export type BookingRefundData = z.infer<typeof bookingRefundDataSchema>;

export type BookingRefundTemplate = {
  id?: string;
  subject: string;
  body: string;
  source: "database" | "file";
};

// Read lazily on first use and cached — keeps the module import-safe and avoids
// re-reading the file on every refund.
let refundTemplateBody: string | null = null;

/** The template shipped with the image: the fallback, and the seed source. */
export function bundledBookingRefundTemplate(): BookingRefundTemplate {
  if (refundTemplateBody == null) {
    refundTemplateBody = readFileSync(
      fileURLToPath(new URL("../onboarding/templates/booking-refund.html", import.meta.url)),
      "utf8",
    );
  }
  return { subject: BOOKING_REFUND_SUBJECT, body: refundTemplateBody, source: "file" };
}

/**
 * The active `BOOKING_REFUND` row, else the bundled file. Read per send rather
 * than cached, so an edit in /modeles reaches the very next refund.
 */
export async function loadBookingRefundTemplate(
  prisma: Pick<PrismaClient, "emailTemplate">,
): Promise<BookingRefundTemplate> {
  try {
    const row = await prisma.emailTemplate.findFirst({
      where: { key: BOOKING_REFUND_TEMPLATE_KEY, archivedAt: null },
      select: { id: true, subject: true, body: true },
    });
    if (row?.body.trim()) return { ...row, source: "database" };
  } catch {
    // Database hiccup/migration pending — telling the customer their money is
    // back matters more than editability, so fall through to the bundled copy.
  }
  return bundledBookingRefundTemplate();
}

/** French money, without the symbol: `39` for 39, `39,50` for 39.5. */
export function formatEuros(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rounded);
}

export type RenderedBookingRefund = { subject: string; html: string; text: string };

export function renderBookingRefundEmail(
  data: BookingRefundData,
  template: BookingRefundTemplate = bundledBookingRefundTemplate(),
): RenderedBookingRefund {
  const amount = formatEuros(data.refundAmountEuros);
  const values = {
    // The name carries its own leading space so an unknown customer gets
    // « Bonjour, » rather than a dangling « Bonjour , ». The template writes the
    // greeting as `Bonjour{{customerName}},`.
    "{{customerName}}": data.customerName ? ` ${data.customerName}` : "",
    "{{salonName}}": data.salonName,
    "{{serviceName}}": data.serviceName,
    "{{bookingDate}}": data.bookingDate,
    "{{bookingTime}}": data.bookingTime,
    "{{refundAmountEuros}}": amount,
  };
  // `{{salon}}` resolves too, so an operator can reuse the shared salon token.
  const salonDraft = { name: data.salonName, contactName: null, bookingUrl: null };

  const greeting = data.customerName ? `Bonjour ${data.customerName},` : "Bonjour,";
  const text = [
    greeting,
    `Nous sommes navrés : votre rendez-vous ${data.serviceName} chez ${data.salonName} le ${data.bookingDate} à ${data.bookingTime} n'a pas pu être honoré.`,
    `Votre acompte de ${amount} € vous a été intégralement remboursé. Il apparaîtra sur votre compte sous 5 à 10 jours ouvrés selon votre banque.`,
    "Toutes nos excuses pour ce désagrément.",
    "L'équipe Glaura — support@glaura.fr",
  ].join("\n\n");

  return {
    subject: renderTemplate(template.subject, salonDraft, { format: "TEXT", values }),
    html: renderTemplate(template.body, salonDraft, { format: "HTML", values }),
    text,
  };
}
