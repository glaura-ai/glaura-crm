/** Stripe trial-ending email + SMS queued through the CRM. */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isBearerAuthorized } from "@/lib/bearer-auth";
import { prisma } from "@/lib/db";
import { defaultEmailFrom } from "@/lib/email";
import {
  loadTrialEndingTemplate,
  renderTrialEndingEmail,
  sendTrialEndingSms,
  trialEndingRequestSchema,
} from "@/lib/transactional/trial-ending";
import { transactionalSalonId } from "@/lib/transactional/transactional-salon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const parsed = trialEndingRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: `invalid_body — ${issueSummary(parsed.error)}` },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const deliveryKey = `pro_trial_ending:${input.eventId}`;
  try {
    const existing = await prisma.emailJob.findFirst({
      where: { templateKey: deliveryKey },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        jobId: existing.id,
        smsSent: false,
      });
    }

    const salon = await prisma.salon.findUnique({
      where: { externalRef: `self_serve:${input.providerId}` },
      select: { id: true },
    });
    const salonId = salon?.id ?? await transactionalSalonId(prisma);
    const template = await loadTrialEndingTemplate(prisma);
    const email = renderTrialEndingEmail(input.data, template);
    const job = await prisma.emailJob.create({
      data: {
        salonId,
        to: input.to,
        from: defaultEmailFrom(),
        templateId: template.id,
        templateKey: deliveryKey,
        subject: email.subject,
        format: "HTML",
        body: email.html,
        bodyText: email.text,
        status: "QUEUED",
      },
      select: { id: true },
    });

    // SMS is attempted only when the event created its email job. A Stripe
    // retry therefore cannot send the salon the same reminder twice.
    const smsSent = input.phone ? await sendTrialEndingSms(input.phone, input.data) : false;
    return NextResponse.json({ success: true, duplicate: false, jobId: job.id, smsSent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("trial_ending_notification_queue_failed", {
      eventId: input.eventId,
      providerId: input.providerId,
      error: message,
    });
    return NextResponse.json({ success: false, error: "queue_failed" }, { status: 500 });
  }
}
