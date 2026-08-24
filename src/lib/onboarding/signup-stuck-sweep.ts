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

  let flagged = 0;
  for (const salon of stuck) {
    // Guarded claim: an onboard dispatch landing between the findMany and this
    // write moves the label past signup_started, and must win — never flag a
    // salon that just completed OAuth with a false "rappeler le salon".
    const claimed = await prisma.$transaction(async (tx) => {
      const updated = await tx.salon.updateMany({
        where: { id: salon.id, accountStatusLabel: "signup_started" },
        data: { accountStatusLabel: "signup_stuck", nextActionAt: now },
      });
      if (updated.count !== 1) return false;
      await tx.reminder.create({
        data: {
          salonId: salon.id,
          title: "Inscription self-serve bloquée à l'étape Instagram — rappeler le salon",
          dueAt: now,
        },
      });
      await tx.activity.create({
        data: {
          salonId: salon.id,
          type: "NOTE",
          notes: "Inscription self-serve bloquée : la vérification Instagram n'a pas abouti " +
            "dans les 30 minutes (compte non professionnel ou connexion abandonnée).",
        },
      });
      return true;
    });
    if (claimed) {
      flagged++;
      console.log(`signup_stuck: ${salon.name} (${salon.id})`);
    }
  }

  return flagged;
}
