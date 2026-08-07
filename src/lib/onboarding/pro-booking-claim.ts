import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeBookingClaim } from "./pro-identity";

export type BookingClaimResult =
  | { claimed: true; bypassed?: true }
  | { claimed: false; conflictSalonId: string | null };

/**
 * Claims one external booking page for one verified /pro salon. Pending or
 * rejected applications never receive a claim, preventing a spammer from
 * locking a legitimate owner out merely by submitting the form first.
 */
export async function claimProBookingUrl(
  prisma: PrismaClient,
  salonId: string,
  bookingClaim: string | null,
  options: { bypass?: boolean } = {},
): Promise<BookingClaimResult> {
  if (options.bypass) return { claimed: true, bypassed: true };
  if (!bookingClaim) return { claimed: false, conflictSalonId: null };

  const currentConflict = await prisma.salon.findFirst({
    where: {
      id: { not: salonId },
      bookingUrlNormalized: bookingClaim,
      OR: [
        { accountStatusLabel: null },
        { accountStatusLabel: { not: "identity_review" } },
      ],
    },
    select: { id: true },
  });
  if (currentConflict) return { claimed: false, conflictSalonId: currentConflict.id };

  // Rows created before bookingUrlNormalized existed still count. This scan is
  // limited to unbackfilled rows and disappears naturally as salons are
  // touched by the new flow.
  const legacy = await prisma.salon.findMany({
    where: {
      id: { not: salonId },
      bookingUrlNormalized: null,
      bookingUrl: { not: null },
      OR: [
        { accountStatusLabel: null },
        { accountStatusLabel: { not: "identity_review" } },
      ],
    },
    select: { id: true, bookingUrl: true },
  });
  const legacyConflict = legacy.find((salon) =>
    normalizeBookingClaim(salon.bookingUrl) === bookingClaim
  );
  if (legacyConflict) return { claimed: false, conflictSalonId: legacyConflict.id };

  try {
    await prisma.salon.update({
      where: { id: salonId },
      data: { bookingUrlNormalized: bookingClaim },
    });
    return { claimed: true };
  } catch (error) {
    // The unique index resolves two workers racing between the reads above.
    if ((error as { code?: string })?.code === "P2002") {
      const conflict = await prisma.salon.findFirst({
        where: { bookingUrlNormalized: bookingClaim },
        select: { id: true },
      });
      return { claimed: false, conflictSalonId: conflict?.id ?? null };
    }
    throw error;
  }
}
