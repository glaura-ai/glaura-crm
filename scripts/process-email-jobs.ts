import { loadEnvConfig } from "@next/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { sendEmail as sendEmailFn } from "../src/lib/email";

loadEnvConfig(process.cwd());

const batchSize = Number(process.env.EMAIL_JOB_BATCH_SIZE || 10);
type Prisma = PrismaClient;
type SendEmail = typeof sendEmailFn;

async function claimJob(prisma: Prisma, id: string) {
  const claimed = await prisma.emailJob.updateMany({
    where: { id, status: "QUEUED" },
    data: { status: "SENDING" },
  });
  if (claimed.count !== 1) {
    return null;
  }
  return prisma.emailJob.findUnique({
    where: { id },
    include: { requestedBy: { select: { email: true } } },
  });
}

async function processJob(prisma: Prisma, sendEmail: SendEmail, id: string) {
  const job = await claimJob(prisma, id);
  if (!job) return;

  try {
    await sendEmail({
      to: job.to,
      subject: job.subject,
      text: job.body,
      replyTo: job.requestedBy?.email,
    });

    await prisma.emailJob.update({
      where: { id: job.id },
      data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
    await prisma.activity.create({
      data: {
        salonId: job.salonId,
        userId: job.requestedById,
        type: "EMAIL",
        notes: `Email envoyé à ${job.to}\nSujet: ${job.subject}`,
      },
    });
    await prisma.salon.update({ where: { id: job.salonId }, data: { lastContactedAt: new Date() } });
    console.log(`sent ${job.id} to ${job.to}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.emailJob.update({
      where: { id: job.id },
      data: { status: "FAILED", attempts: { increment: 1 }, lastError: message.slice(0, 2000) },
    });
    console.error(`failed ${job.id}: ${message}`);
  }
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { sendEmail } = await import("../src/lib/email");
  const jobs = await prisma.emailJob.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: { id: true },
  });

  for (const job of jobs) {
    await processJob(prisma, sendEmail, job.id);
  }

  console.log(`processed ${jobs.length} email job(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  });
