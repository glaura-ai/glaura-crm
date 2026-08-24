import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { registerSignupStarted } from "./signup-started";

function fakePrisma(input: {
  existing?: { id: string; accountStatusLabel: string | null } | null;
  slugTaken?: string[];
}) {
  const taken = new Set(input.slugTaken ?? []);
  const findFirst = vi.fn().mockResolvedValue(input.existing ?? null);
  const findUnique = vi.fn(async ({ where }: { where: { slug: string } }) =>
    taken.has(where.slug) ? { id: "other" } : null);
  const update = vi.fn().mockResolvedValue({ id: input.existing?.id ?? "salon-1" });
  const create = vi.fn().mockResolvedValue({ id: "salon-new" });
  const activityCreate = vi.fn().mockResolvedValue({ id: "activity-1" });
  const prisma = {
    salon: { findFirst, findUnique, update, create },
    activity: { create: activityCreate },
  } as unknown as PrismaClient;
  return { prisma, findFirst, update, create, activityCreate };
}

const input = {
  targetUid: "uid-123",
  email: "salon@example.com",
  salonName: "Pour La Beauté",
  bookingUrl: "https://www.planity.com/pour-la-beaute",
  phone: "+33612345678",
  instagramHandle: "pour_labeautee",
  planCode: "reservation" as const,
};

describe("self-serve signup registration", () => {
  it("creates a pipeline row + note the moment a signup starts", async () => {
    const { prisma, create, activityCreate } = fakePrisma({});

    const result = await registerSignupStarted(prisma, input);

    expect(result).toEqual({ salonId: "salon-new", created: true });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: "Pour La Beauté",
        contactEmail: "salon@example.com",
        instagram: "pour_labeautee",
        bookingTool: "PLANITY",
        externalRef: "self_serve:uid-123",
        status: "INTERESSE",
        accountStatusLabel: "signup_started",
        source: "IMPORT",
      }),
    }));
    expect(activityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ salonId: "salon-new", type: "NOTE" }),
    }));
  });

  it("re-arms a stuck row when the salon retries the signup", async () => {
    const { prisma, update, create, activityCreate } = fakePrisma({
      existing: { id: "salon-9", accountStatusLabel: "signup_stuck" },
    });

    const result = await registerSignupStarted(prisma, input);

    expect(result).toEqual({ salonId: "salon-9", created: false });
    expect(create).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "salon-9" },
      data: expect.objectContaining({ accountStatusLabel: "signup_started" }),
    }));
  });

  it("never regresses a salon that already progressed past signup", async () => {
    const { prisma, update } = fakePrisma({
      existing: { id: "salon-9", accountStatusLabel: "pro_preview" },
    });

    await registerSignupStarted(prisma, input);

    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.accountStatusLabel).toBeUndefined();
    expect(data.status).toBeUndefined();
  });
});
