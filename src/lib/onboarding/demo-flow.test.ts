import { describe, expect, it, vi } from "vitest";
import { flagDemoForHumanCall, markDemoToBook } from "./demo-flow";

function fakePrisma() {
  const salonUpdate = vi.fn().mockResolvedValue({});
  const reminderCreate = vi.fn().mockResolvedValue({});
  const tx = { salon: { update: salonUpdate }, reminder: { create: reminderCreate } };
  const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { prisma: prisma as never, salonUpdate, reminderCreate };
}
const now = new Date("2026-11-11T10:00:00Z");

describe("demo flow CRM follow-up", () => {
  it("labels the salon demo_to_book, hot, due now, with a reminder", async () => {
    const { prisma, salonUpdate, reminderCreate } = fakePrisma();
    await markDemoToBook(prisma, { salonId: "s1", salonName: "Studio" }, now);
    expect(salonUpdate).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { accountStatusLabel: "demo_to_book", leadTemperature: "CHAUD", nextActionAt: now },
    });
    expect(reminderCreate).toHaveBeenCalledWith({
      data: { salonId: "s1", title: "Démo à réserver : appeler Studio", dueAt: now },
    });
  });
  it("schedules a human call without touching the label on failures", async () => {
    const { prisma, salonUpdate, reminderCreate } = fakePrisma();
    await flagDemoForHumanCall(prisma, { salonId: "s1", salonName: "Studio", reason: "conflit de lien de réservation" }, now);
    expect(salonUpdate).toHaveBeenCalledWith({ where: { id: "s1" }, data: { nextActionAt: now } });
    expect(reminderCreate.mock.calls[0][0].data).toMatchObject({ salonId: "s1", dueAt: now });
    expect(reminderCreate.mock.calls[0][0].data.title).toContain("Studio");
  });
});
