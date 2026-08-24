import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { SIGNUP_STUCK_AFTER_MS, sweepStuckSignups } from "./signup-stuck-sweep";

function fakePrisma(input: {
  stuck: Array<{ id: string; name: string }>;
  claimCount?: number;
}) {
  const findMany = vi.fn().mockResolvedValue(input.stuck);
  const updateMany = vi.fn().mockResolvedValue({ count: input.claimCount ?? 1 });
  const reminderCreate = vi.fn().mockResolvedValue({});
  const activityCreate = vi.fn().mockResolvedValue({});
  const tx = {
    salon: { updateMany },
    reminder: { create: reminderCreate },
    activity: { create: activityCreate },
  };
  const $transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
  const prisma = {
    salon: { findMany },
    $transaction,
  } as unknown as PrismaClient;
  return { prisma, findMany, updateMany, reminderCreate, activityCreate };
}

describe("stuck self-serve signup sweep", () => {
  it("only scans signups that have waited past the grace window", async () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const { prisma, findMany } = fakePrisma({ stuck: [] });

    const flagged = await sweepStuckSignups(prisma, now);

    expect(flagged).toBe(0);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        accountStatusLabel: "signup_started",
        archivedAt: null,
        updatedAt: { lt: new Date(now.getTime() - SIGNUP_STUCK_AFTER_MS) },
      }),
    }));
  });

  it("flags each stuck salon with a label, due reminder and note", async () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const { prisma, updateMany, reminderCreate, activityCreate } =
      fakePrisma({ stuck: [{ id: "salon-1", name: "Pour La Beauté" }] });

    const flagged = await sweepStuckSignups(prisma, now);

    expect(flagged).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "salon-1", accountStatusLabel: "signup_started" },
      data: expect.objectContaining({
        accountStatusLabel: "signup_stuck",
        nextActionAt: now,
      }),
    }));
    expect(reminderCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ salonId: "salon-1", dueAt: now }),
    }));
    expect(activityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ salonId: "salon-1", type: "NOTE" }),
    }));
  });

  it("backs off when the salon progressed between scan and claim", async () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const { prisma, reminderCreate, activityCreate } =
      fakePrisma({ stuck: [{ id: "salon-1", name: "Pour La Beauté" }], claimCount: 0 });

    const flagged = await sweepStuckSignups(prisma, now);

    expect(flagged).toBe(0);
    expect(reminderCreate).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
  });
});
