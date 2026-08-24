/**
 * Flags self-serve signups that never came back from the Instagram gate.
 *
 * A `signup_started` row still untouched after the grace window becomes
 * `signup_stuck`, gets `nextActionAt` now (dashboard "priorités"), a due
 * reminder, and a timeline note — so a rep calls the salon instead of the
 * signup silently dying inside Meta's flow. A retry through
 * /api/self-serve/signup-started resets the label and re-arms the sweep.
 */

import type { PrismaClient } from "@/generated/prisma/client";

/** Matches the portal's 30-minute OAuth session TTL: once the session has
 * expired the salon cannot complete that attempt anymore. */
export const SIGNUP_STUCK_AFTER_MS = 30 * 60 * 1000;

export async function sweepStuckSignups(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const stuck = await prisma.salon.findMany({
    where: {
      accountStatusLabel: "signup_started",
      archivedAt: null,
      updatedAt: { lt: new Date(now.getTime() - SIGNUP_STUCK_AFTER_MS) },
    },
    select: { id: true, name: true },
  });

  for (const salon of stuck) {
    await prisma.$transaction([
      prisma.salon.update({
        where: { id: salon.id },
        data: { accountStatusLabel: "signup_stuck", nextActionAt: now },
      }),
      prisma.reminder.create({
        data: {
          salonId: salon.id,
          title: "Inscription self-serve bloquée à l'étape Instagram — rappeler le salon",
          dueAt: now,
        },
      }),
      prisma.activity.create({
        data: {
          salonId: salon.id,
          type: "NOTE",
          notes: "Inscription self-serve bloquée : la vérification Instagram n'a pas abouti " +
            "dans les 30 minutes (compte non professionnel ou connexion abandonnée).",
        },
      }),
    ]);
    console.log(`signup_stuck: ${salon.name} (${salon.id})`);
  }

  return stuck.length;
}
