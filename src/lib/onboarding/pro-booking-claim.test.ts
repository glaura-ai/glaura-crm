import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { claimProBookingUrl } from "./pro-booking-claim";

function fakePrisma(input: {
  currentConflict?: { id: string } | null;
  legacy?: Array<{ id: string; bookingUrl: string | null }>;
}) {
  const update = vi.fn().mockResolvedValue({ id: "salon-new" });
  const findFirst = vi.fn().mockResolvedValue(input.currentConflict ?? null);
  const findMany = vi.fn().mockResolvedValue(input.legacy ?? []);
  const prisma = { salon: { findFirst, findMany, update } } as unknown as PrismaClient;
  return { prisma, update };
}

describe("verified booking-page claims", () => {
  it("rejects a claim already held by another salon", async () => {
    const { prisma, update } = fakePrisma({ currentConflict: { id: "salon-existing" } });
    const result = await claimProBookingUrl(prisma, "salon-new", "planity.com/studio");

    expect(result).toEqual({ claimed: false, conflictSalonId: "salon-existing" });
    expect(update).not.toHaveBeenCalled();
  });

  it("recognizes legacy booking URLs that predate the canonical column", async () => {
    const { prisma, update } = fakePrisma({
      legacy: [{ id: "legacy", bookingUrl: "https://www.planity.com/studio/?utm_source=old" }],
    });
    const result = await claimProBookingUrl(prisma, "salon-new", "planity.com/studio");

    expect(result).toEqual({ claimed: false, conflictSalonId: "legacy" });
    expect(update).not.toHaveBeenCalled();
  });

  it("persists an unclaimed canonical booking URL", async () => {
    const { prisma, update } = fakePrisma({});
    const result = await claimProBookingUrl(prisma, "salon-new", "planity.com/studio");

    expect(result).toEqual({ claimed: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: "salon-new" },
      data: { bookingUrlNormalized: "planity.com/studio" },
    });
  });
});
