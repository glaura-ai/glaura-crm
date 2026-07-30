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
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/slugs";
import type { $Enums } from "@/generated/prisma/client";

type BookingTool = $Enums.BookingTool;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  /** Contact person. The form requires it. */
  name: z.string().trim().min(1).max(120),
  /** The form requires it — this is a callback request. */
  phone: z.string().trim().min(1).max(40),
  email: z.string().email().max(190).optional().nullable(),
  instagram: z.string().trim().max(120).optional().nullable(),
  /** Salon name; falls back to the contact name when the salon skipped it. */
  salon: z.string().trim().max(190).optional().nullable(),
  /** Planity/Treatwell/Booksy/site URL. Optional on the form, so optional here. */
  bookingLink: z.string().trim().max(500).optional().nullable(),
  /** Airtable record id, when the site managed to write there too. Doubles as
   *  the idempotency key so the two systems point at the same lead. */
  airtableRecordId: z.string().trim().max(64).optional().nullable(),
  source: z.string().trim().max(255).optional().nullable(),
  utmSource: z.string().trim().max(255).optional().nullable(),
  utmMedium: z.string().trim().max(255).optional().nullable(),
  utmCampaign: z.string().trim().max(255).optional().nullable(),
});

/** Maps a booking-page host to its CRM BookingTool. Mirrors the mapping in
 *  /api/self-serve/onboard — keep the two in step. */
function detectBookingTool(url: string | null | undefined): BookingTool {
  if (!url) return "NONE";
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "SITE";
  }
  if (host.includes("planity")) return "PLANITY";
  if (host.includes("treatwell")) return "TREATWELL";
  if (host.includes("booksy")) return "BOOKSY";
  if (host.includes("acuity")) return "ACUITY";
  if (host.includes("fresha")) return "FRESHA";
  return "SITE";
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.LAURA_LEAD_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  // Idempotency: the Airtable record id when we have one, else the phone the
  // salon asked to be called on. A double submit updates one row, never two.
  const externalRef = body.airtableRecordId
    ? `laura_lead:${body.airtableRecordId}`
    : `laura_lead_phone:${body.phone.replace(/\s+/g, "")}`;

  const salonName = body.salon || body.name;
  const notes = [
    "Demande de rappel depuis /laura.",
    body.source ? `Source : ${body.source}` : null,
    [body.utmSource, body.utmMedium, body.utmCampaign].some(Boolean)
      ? `UTM : ${[body.utmSource, body.utmMedium, body.utmCampaign].filter(Boolean).join(" / ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

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

  return NextResponse.json({ ok: true, salonId: salon.id, created: !existing });
}
