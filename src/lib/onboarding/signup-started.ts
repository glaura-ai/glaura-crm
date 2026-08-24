/**
 * Registers a self-serve signup in the pipeline the moment it starts — before
 * the Instagram ownership gate. Until 2026-08 the first CRM write happened
 * only after OAuth succeeded, so every salon that Meta bounced simply never
 * existed here and the team could not see (or rescue) them.
 *
 * The row is idempotent per portal account (`externalRef self_serve:{uid}`):
 * the later /api/self-serve/onboard dispatch updates the same row, and the
 * worker sweep flags rows still waiting as `signup_stuck`.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { slugify } from "@/lib/slugs";
import { detectBookingTool, reserveSalonSlug } from "./self-serve-salon";

export type SignupStartedInput = {
  /** Firebase uid of the minimal account the portal created. */
  targetUid: string;
  email: string;
  salonName: string;
  bookingUrl: string;
  contactName?: string;
  phone?: string;
  /** Already-normalized bare handle (the route normalizes). */
  instagramHandle?: string | null;
  planCode?: "basic" | "reservation";
};

/** Labels a fresh signup may overwrite. `import_failed` is included so a salon
 * retrying after a failed import re-arms the stuck sweep instead of keeping a
 * stale failure chip. Anything else means the salon already progressed
 * (preview built, onboarded, in review) and must not regress. */
const RESETTABLE_LABELS = new Set([
  "signup_started",
  "signup_stuck",
  "oauth_cancelled",
  "import_failed",
]);

export async function registerSignupStarted(
  prisma: PrismaClient,
  input: SignupStartedInput,
): Promise<{ salonId: string; created: boolean }> {
  const externalRef = `self_serve:${input.targetUid}`;
  const { bookingTool } = detectBookingTool(input.bookingUrl);
  const contactFields = {
    name: input.salonName,
    phone: input.phone ?? null,
    contactName: input.contactName ?? null,
    contactEmail: input.email,
    instagram: input.instagramHandle ?? null,
    bookingTool,
    bookingUrl: input.bookingUrl,
  };

  const existing = await prisma.salon.findFirst({
    where: { externalRef },
    select: { id: true, accountStatusLabel: true },
  });

  if (existing) {
    const resettable = !existing.accountStatusLabel ||
      RESETTABLE_LABELS.has(existing.accountStatusLabel);
    await prisma.salon.update({
      where: { id: existing.id },
      data: {
        ...contactFields,
        ...(resettable ? { accountStatusLabel: "signup_started" } : {}),
      },
    });
    return { salonId: existing.id, created: false };
  }

  let salon: { id: string };
  try {
    salon = await prisma.salon.create({
      data: {
        ...contactFields,
        slug: await reserveSalonSlug(prisma, slugify(input.salonName)),
        source: "IMPORT",
        externalRef,
        status: "INTERESSE",
        accountStatusLabel: "signup_started",
      },
      select: { id: true },
    });
  } catch (error) {
    // Double-submit race: both requests miss the findFirst, the loser hits the
    // unique externalRef (P2002). Treat it as the update path it should be.
    if ((error as { code?: string })?.code === "P2002") {
      const raced = await prisma.salon.findFirst({ where: { externalRef }, select: { id: true } });
      if (raced) {
        await prisma.salon.update({
          where: { id: raced.id },
          data: { ...contactFields, accountStatusLabel: "signup_started" },
        });
        return { salonId: raced.id, created: false };
      }
    }
    throw error;
  }
  await prisma.activity.create({
    data: {
      salonId: salon.id,
      type: "NOTE",
      notes: "Inscription self-serve démarrée — en attente de la vérification Instagram." +
        (input.planCode ? ` Plan choisi : ${input.planCode}.` : ""),
    },
  });
  return { salonId: salon.id, created: true };
}
