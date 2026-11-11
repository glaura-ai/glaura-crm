import type { PrismaClient } from "@/generated/prisma/client";

type SalonRef = { salonId: string; salonName: string };

/** Demo flow: the preview is sent, a rep must now get the salon to book a demo. */
export async function markDemoToBook(
  prisma: Pick<PrismaClient, "$transaction">,
  { salonId, salonName }: SalonRef,
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salonId },
      data: { accountStatusLabel: "demo_to_book", leadTemperature: "CHAUD", nextActionAt: now },
    });
    await tx.reminder.create({
      data: { salonId, title: `Démo à réserver : appeler ${salonName}`, dueAt: now },
    });
  });
}

/** Demo flow ended without a preview (review hold, failed import): a human calls. */
export async function flagDemoForHumanCall(
  prisma: Pick<PrismaClient, "$transaction">,
  { salonId, salonName, reason }: SalonRef & { reason: string },
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.salon.update({ where: { id: salonId }, data: { nextActionAt: now } });
    await tx.reminder.create({
      data: { salonId, title: `Inscription démo bloquée (${reason}) : appeler ${salonName}`, dueAt: now },
    });
  });
}
