import { prisma } from "@/lib/db";

export async function getOnboardingMonitor(selectedJobId?: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [jobs, statusCounts, recentCompleted] = await Promise.all([
    prisma.onboardingJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        salon: { select: { id: true, name: true, bookingTool: true, assignedTo: { select: { name: true, email: true } } } },
        requestedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.onboardingJob.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.onboardingJob.findMany({
      where: { createdAt: { gte: since }, durationMs: { not: null } },
      select: { durationMs: true, status: true, sourceType: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  const selectedId = selectedJobId ?? jobs[0]?.id;
  const selectedJob = selectedId
    ? await prisma.onboardingJob.findUnique({
        where: { id: selectedId },
        include: {
          salon: { select: { id: true, name: true } },
          events: { orderBy: { sequence: "desc" }, take: 120 },
        },
      })
    : null;

  const counts = Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all]));
  const completedDurations = recentCompleted.map((job) => job.durationMs).filter((duration): duration is number => duration != null);
  const successCount = (counts.DONE ?? 0) + (counts.ALREADY_ONBOARDED ?? 0);
  const totalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return {
    jobs,
    selectedJob,
    metrics: {
      total30d: totalCount,
      success30d: successCount,
      failed30d: counts.FAILED ?? 0,
      processing30d: counts.PROCESSING ?? 0,
      successRate30d: totalCount ? Math.round((successCount / totalCount) * 100) : 0,
      p50DurationMs: percentile(completedDurations, 50),
      p95DurationMs: percentile(completedDurations, 95),
    },
  };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}
