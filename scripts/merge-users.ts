import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

// Early imports assigned salons to placeholder emails that don't match the
// Google OAuth email each commercial actually signs in with. That created two
// User rows per person, so on login they saw zero salons. Merge the orphan
// (import) row into the canonical (login) row. Idempotent — safe to re-run.
//
// `from` = orphan email created by the import. `to` = the Google login email.
const MERGES: ReadonlyArray<{ from: string; to: string }> = [
  { from: "namory@glaura.fr", to: "f.namory@glaura.fr" },
  { from: "antoine@glaura.fr", to: "a.ribeiro@glaura.fr" },
];

const DRY_RUN = process.argv.includes("--dry");

async function relationCounts(userId: string) {
  const [salons, activities, reminders, onboarding, emails] = await Promise.all([
    prisma.salon.count({ where: { assignedToId: userId } }),
    prisma.activity.count({ where: { userId } }),
    prisma.reminder.count({ where: { userId } }),
    prisma.onboardingJob.count({ where: { requestedById: userId } }),
    prisma.emailJob.count({ where: { requestedById: userId } }),
  ]);
  return { salons, activities, reminders, onboarding, emails };
}

async function mergeUser(fromEmail: string, toEmail: string) {
  const source = await prisma.user.findUnique({ where: { email: fromEmail } });
  if (!source) return { from: fromEmail, to: toEmail, action: "skip (no orphan)" };

  const target = await prisma.user.findUnique({ where: { email: toEmail } });

  if (DRY_RUN) {
    const counts = await relationCounts(source.id);
    const action = !target
      ? "WOULD rename orphan → login email"
      : target.id === source.id
        ? "skip (already merged)"
        : "WOULD merge + delete orphan";
    return { from: fromEmail, to: toEmail, action, ...counts };
  }

  // Login row doesn't exist yet → just adopt the canonical email on the orphan.
  if (!target) {
    await prisma.user.update({ where: { id: source.id }, data: { email: toEmail } });
    return { from: fromEmail, to: toEmail, action: "renamed orphan → login email" };
  }
  if (target.id === source.id) return { from: fromEmail, to: toEmail, action: "skip (already merged)" };

  const moved = await prisma.$transaction(async (tx) => {
    const salons = await tx.salon.updateMany({ where: { assignedToId: source.id }, data: { assignedToId: target.id } });
    const activities = await tx.activity.updateMany({ where: { userId: source.id }, data: { userId: target.id } });
    const reminders = await tx.reminder.updateMany({ where: { userId: source.id }, data: { userId: target.id } });
    const onboarding = await tx.onboardingJob.updateMany({ where: { requestedById: source.id }, data: { requestedById: target.id } });
    const emails = await tx.emailJob.updateMany({ where: { requestedById: source.id }, data: { requestedById: target.id } });
    await tx.user.delete({ where: { id: source.id } });
    return { salons: salons.count, activities: activities.count, reminders: reminders.count, onboarding: onboarding.count, emails: emails.count };
  });

  return { from: fromEmail, to: toEmail, action: "merged + deleted orphan", ...moved };
}

async function main() {
  if (DRY_RUN) console.log("DRY RUN — no changes will be written.\n");
  const results = [];
  for (const { from, to } of MERGES) {
    results.push(await mergeUser(from, to));
  }
  console.table(results);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
