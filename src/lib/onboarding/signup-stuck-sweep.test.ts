import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { SIGNUP_STUCK_AFTER_MS, sweepStuckSignups } from "./signup-stuck-sweep";

function fakePrisma(stuck: Array<{ id: string; name: string }>) {
  const findMany = vi.fn().mockResolvedValue(stuck);
  const update = vi.fn().mockResolvedValue({});
  const reminderCreate = vi.fn().mockResolvedValue({});
  const activityCreate = vi.fn().mockResolvedValue({});
  const $transaction = vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
  const prisma = {
    salon: { findMany, update },
    reminder: { create: reminderCreate },
    activity: { create: activityCreate },
    $transaction,
  } as unknown as PrismaClient;
  return { prisma, findMany, update, reminderCreate, activityCreate };
}

describe("stuck self-serve signup sweep", () => {
  it("only scans signups that have waited past the grace window", async () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const { prisma, findMany } = fakePrisma([]);

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
    const { prisma, update, reminderCreate, activityCreate } =
      fakePrisma([{ id: "salon-1", name: "Pour La Beauté" }]);

    const flagged = await sweepStuckSignups(prisma, now);

    expect(flagged).toBe(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "salon-1" },
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
});
