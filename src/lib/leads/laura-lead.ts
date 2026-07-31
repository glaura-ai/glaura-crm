// Pure logic behind POST /api/leads/laura.
//
// Extracted from the route so it can be tested without a database or a
// Request: the route stays a thin adapter (auth → parse → derive → persist),
// and everything that decides *what* gets written lives here.

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizeInstagramHandle } from "@/lib/instagram";
import type { $Enums } from "@/generated/prisma/client";

type BookingTool = $Enums.BookingTool;

export const lauraLeadSchema = z.object({
  /** Contact person. The form requires it. */
  name: z.string().trim().min(1).max(120),
  /** The form requires it — this is a callback request. */
  phone: z.string().trim().min(1).max(40),
  email: z.string().email().max(190).optional().nullable(),
  /** Handle, @handle or a pasted profile URL — normalized to a bare handle, so
   *  the length cap has to leave room for a URL rather than reject the lead. */
  instagram: z.string().trim().max(500).optional().nullable().transform(normalizeInstagramHandle),
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
  /** True once the salon has typed the SMS code we sent to `phone`.
   *
   *  The lead itself is recorded either way — a commercial can call back a
   *  number nobody confirmed. What this gates is account creation and the
   *  access email, the only two effects with any blast radius: without it, a
   *  public form could mint Glaura accounts for other people's salons and mail
   *  strangers. Defaults to false so a caller that forgets it gets the safe
   *  behaviour rather than the dangerous one. */
  phoneVerified: z.boolean().optional().default(false),
});

export type LauraLead = z.infer<typeof lauraLeadSchema>;

/** Maps a booking-page host to its CRM BookingTool. Mirrors the mapping in
 *  /api/self-serve/onboard — keep the two in step. */
export function detectBookingTool(url: string | null | undefined): BookingTool {
  if (!url) return "NONE";
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Not a parseable URL, but the salon typed *something* — treat it as their
    // own site rather than discarding it.
    return "SITE";
  }
  if (host.includes("planity")) return "PLANITY";
  if (host.includes("treatwell")) return "TREATWELL";
  if (host.includes("booksy")) return "BOOKSY";
  if (host.includes("acuity")) return "ACUITY";
  if (host.includes("fresha")) return "FRESHA";
  return "SITE";
}

/** Idempotency key. The Airtable record id when we have one, so the two
 *  systems point at the same lead; otherwise the phone the salon asked to be
 *  called on, which is the one field the form always requires. */
export function externalRefFor(lead: Pick<LauraLead, "airtableRecordId" | "phone">): string {
  return lead.airtableRecordId
    ? `laura_lead:${lead.airtableRecordId}`
    : `laura_lead_phone:${lead.phone.replace(/\s+/g, "")}`;
}

/** The salon's own name when given, else the contact's — a Salon row needs one. */
export function salonNameFor(lead: Pick<LauraLead, "salon" | "name">): string {
  return lead.salon?.trim() || lead.name;
}

/** What a commercial reads before calling back. */
export function notesFor(
  lead: Pick<LauraLead, "source" | "utmSource" | "utmMedium" | "utmCampaign">,
): string {
  const utm = [lead.utmSource, lead.utmMedium, lead.utmCampaign].filter(Boolean);
  return [
    "Demande de rappel depuis /laura.",
    lead.source ? `Source : ${lead.source}` : null,
    utm.length ? `UTM : ${utm.join(" / ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Constant-time bearer check. Returns false when unconfigured, so a missing
 *  secret closes the endpoint instead of opening it. */
export function isBearerAuthorized(
  authorizationHeader: string | null | undefined,
  secret: string | undefined,
): boolean {
  const expected = secret?.trim();
  if (!expected) return false;
  const header = authorizationHeader ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // Length must match before timingSafeEqual, which throws on a mismatch.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
