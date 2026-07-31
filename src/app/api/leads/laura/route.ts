/**
 * Inbound Laura lead API.
 *
 * A service-to-service endpoint the marketing site calls when a salon submits
 * the "être rappelée" form on /laura. It lands the lead directly in the CRM
 * pipeline so a commercial can work it, instead of it sitting in Airtable until
 * someone remembers to run `scripts/import-airtable.ts`.
 *
 * This is deliberately NOT /api/self-serve/onboard: that endpoint provisions an
 * account and enqueues a scrape job. A callback request is a lead, not a signup
 * — the salon has asked to be called, nothing more, and its booking URL is
 * optional.
 *
 * Auth is a shared secret (`LAURA_LEAD_SECRET`) presented as
 * `Authorization: Bearer <secret>` and compared in constant time, mirroring the
 * self-serve endpoint.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/slugs";
import {
  detectBookingTool,
  externalRefFor,
  isBearerAuthorized,
  lauraLeadSchema,
  notesFor,
  salonNameFor,
} from "@/lib/leads/laura-lead";
import { provisionLauraAccount } from "@/lib/leads/laura-provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reserves the first free Salon slug starting at `base`, then `base-1`, … */
async function reserveSalonSlug(base: string): Promise<string> {
  const root = base || "salon";
  for (let i = 0; i < 500; i++) {
    const candidate = i === 0 ? root : `${root}-${i}`;
    const existing = await prisma.salon.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  throw new Error(`Could not reserve a free Salon slug for base "${base}"`);
}

export async function POST(req: NextRequest) {
  if (!isBearerAuthorized(req.headers.get("authorization"), process.env.LAURA_LEAD_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = lauraLeadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  const externalRef = externalRefFor(body);
  const salonName = salonNameFor(body);
  const notes = notesFor(body);

  const existing = await prisma.salon.findFirst({ where: { externalRef }, select: { id: true } });

  const shared = {
    name: salonName,
    contactName: body.name,
    contactEmail: body.email ?? undefined,
    phone: body.phone,
    instagram: body.instagram ?? undefined,
    bookingUrl: body.bookingLink ?? undefined,
    bookingTool: detectBookingTool(body.bookingLink),
    // The salon raised its hand; it is warmer than anything we found ourselves.
    status: "INTERESSE" as const,
    leadTemperature: "CHAUD",
    sourceLabel: "Page /laura",
    notes,
    lastContactedAt: null,
  };

  const salon = existing
    ? await prisma.salon.update({ where: { id: existing.id }, data: shared })
    : await prisma.salon.create({
        data: {
          ...shared,
          slug: await reserveSalonSlug(slugify(salonName)),
          source: "MANUAL",
          externalRef,
          // Someone has to ring them back — surface it on today's list.
          nextActionAt: new Date(),
        },
      });

  // Create the Glaura account and email the salon a way in. Deliberately after
  // the CRM write and deliberately non-fatal: the lead is already captured in
  // Airtable and here, so a bad minute in Firebase must not lose it. The salon
  // gets a callback either way, and a commercial can trigger access by hand.
  const account = await provisionLauraAccount({
    bookingUrl: body.bookingLink,
    contactName: body.name,
    email: body.email ?? "",
    instagram: body.instagram,
    phone: body.phone,
    salonName,
  });

  if (account.status === "failed") {
    console.error("laura_lead_account_failed", { externalRef, error: account.error });
  } else if (account.status !== "skipped" && !account.emailSent) {
    console.error("laura_lead_access_email_failed", { externalRef, error: account.emailError });
  }

  return NextResponse.json({
    ok: true,
    salonId: salon.id,
    created: !existing,
    account: account.status,
    accessEmailSent: account.status === "created" || account.status === "existing"
      ? account.emailSent
      : false,
  });
}
