/**
 * Transactional « réservation remboursée » email.
 *
 * A service-to-service endpoint Cloud Functions calls after an admin refunds a
 * booking: the appointment could not be honoured and the deposit is on its way
 * back, so the customer must hear it from us rather than from their bank
 * statement. The CRM owns the Workspace SMTP relay, so the refund path queues
 * an `EmailJob` here instead of opening its own connection — a relay outage
 * then retries in the worker rather than failing the refund.
 *
 * Auth is a shared secret (`TRANSACTIONAL_EMAIL_SECRET`) presented as
 * `Authorization: Bearer <secret>` and compared in constant time, mirroring
 * /api/leads/laura. An unset secret answers 503: nothing can authenticate, and
 * a caller deserves to know the endpoint is unconfigured rather than chase a
 * wrong-credentials 401.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isBearerAuthorized } from "@/lib/bearer-auth";
import { prisma } from "@/lib/db";
import { defaultEmailFrom } from "@/lib/email";
import {
  BOOKING_REFUND_TEMPLATE_KEY,
  bookingRefundRequestSchema,
  loadBookingRefundTemplate,
  renderBookingRefundEmail,
} from "@/lib/transactional/booking-refund";
import { transactionalSalonId } from "@/lib/transactional/transactional-salon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One readable line out of a zod failure, e.g. `data.bookingTime: Required`. */
function issueSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

export async function POST(req: NextRequest) {
  const secret = process.env.TRANSACTIONAL_EMAIL_SECRET;
  if (!secret?.trim()) {
    return NextResponse.json({ success: false, error: "transactional_email_not_configured" }, { status: 503 });
  }
  if (!isBearerAuthorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = bookingRefundRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: `invalid_body — ${issueSummary(parsed.error)}` },
      { status: 400 },
    );
  }

  try {
    const template = await loadBookingRefundTemplate(prisma);
    const email = renderBookingRefundEmail(parsed.data.data, template);
    const job = await prisma.emailJob.create({
      data: {
        salonId: await transactionalSalonId(prisma),
        to: parsed.data.to,
        from: defaultEmailFrom(),
        templateId: template.id,
        templateKey: BOOKING_REFUND_TEMPLATE_KEY,
        subject: email.subject,
        format: "HTML",
        body: email.html,
        bodyText: email.text,
        status: "QUEUED",
      },
      select: { id: true },
    });

    return NextResponse.json({ success: true, jobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("booking_refund_email_queue_failed", { to: parsed.data.to, error: message });
    return NextResponse.json({ success: false, error: "queue_failed" }, { status: 500 });
  }
}
