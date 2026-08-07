/**
 * The CRM row that owns transactional customer emails.
 *
 * `EmailJob` hangs off a `Salon` — the queue was built for salon
 * correspondence, and the worker stamps `lastContactedAt` on that salon after
 * every send. A refund notice goes to a CUSTOMER, so attaching it to the real
 * salon would both file it under someone else's correspondence and forge a
 * commercial touch that never happened, moving the salon down the relance list.
 *
 * So transactional jobs hang off one dedicated, archived row instead. Archived
 * keeps it out of the pipeline (`src/lib/salons.ts` and the dashboard filter on
 * `archivedAt: null`), and the worker's `lastContactedAt` bump lands somewhere
 * harmless.
 */

import type { PrismaClient } from "@/generated/prisma/client";

export const TRANSACTIONAL_SALON_SLUG = "glaura-emails-transactionnels";
const TRANSACTIONAL_SALON_EXTERNAL_REF = "system:transactional-email";

/** Finds — or creates once — the row transactional `EmailJob`s belong to. */
export async function transactionalSalonId(prisma: Pick<PrismaClient, "salon">): Promise<string> {
  const existing = await prisma.salon.findUnique({
    where: { slug: TRANSACTIONAL_SALON_SLUG },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await prisma.salon.create({
      data: {
        name: "Glaura — emails transactionnels",
        slug: TRANSACTIONAL_SALON_SLUG,
        externalRef: TRANSACTIONAL_SALON_EXTERNAL_REF,
        source: "MANUAL",
        archivedAt: new Date(),
        archiveNote: "Ligne système : porte les emails transactionnels envoyés aux clientes. Ne pas prospecter.",
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // Two refunds landing at once both miss the read above; the loser of the
    // unique-slug race just reads what the winner wrote.
    const raced = await prisma.salon.findUnique({
      where: { slug: TRANSACTIONAL_SALON_SLUG },
      select: { id: true },
    });
    if (raced) return raced.id;
    throw error;
  }
}
