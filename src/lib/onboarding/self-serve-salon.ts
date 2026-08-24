/**
 * Salon-row helpers shared by the self-serve service endpoints
 * (/api/self-serve/onboard and /api/self-serve/signup-started).
 */

import type { PrismaClient } from "@/generated/prisma/client";
import type { $Enums } from "@/generated/prisma/client";

type BookingTool = $Enums.BookingTool;

/** Maps a booking-page host to its CRM BookingTool + worker sourceType string. */
export function detectBookingTool(url: string): { bookingTool: BookingTool; sourceType: string } {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (host.includes("planity")) return { bookingTool: "PLANITY", sourceType: "planity" };
  if (host.includes("treatwell")) return { bookingTool: "TREATWELL", sourceType: "treatwell" };
  if (host.includes("booksy")) return { bookingTool: "BOOKSY", sourceType: "booksy" };
  if (host.includes("acuity") || host.includes("acuityscheduling")) return { bookingTool: "ACUITY", sourceType: "acuity" };
  if (host.includes("fresha")) return { bookingTool: "FRESHA", sourceType: "fresha" };
  return { bookingTool: "SITE", sourceType: "generic" };
}

/** Reserves the first free Salon slug starting at `base`, then `base-1`, … */
export async function reserveSalonSlug(prisma: PrismaClient, base: string): Promise<string> {
  const root = base || "salon";
  for (let i = 0; i < 500; i++) {
    const candidate = i === 0 ? root : `${root}-${i}`;
    const existing = await prisma.salon.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  throw new Error(`Could not reserve a free Salon slug for base "${base}"`);
}
