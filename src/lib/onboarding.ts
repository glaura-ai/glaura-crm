import { spawn } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

type OnboardingResult = {
  status?: string;
  ownerId?: string | null;
  email?: string | null;
  password?: string | null;
  address?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  serviceCount?: number | null;
  agentCount?: number | null;
  videoCount?: number | null;
  sourceType?: string | null;
  warnings?: unknown;
  error?: string | null;
};

export type OnboardingHints = {
  crmSalonId?: string | null;
  salonName?: string | null;
  instagram?: string | null;
  instagramHandle?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  bookingTool?: string | null;
};

const DEFAULT_COMMAND = "./onboarding/run-onboard.sh";
const DEFAULT_RESULT_DIR = "./tmp/onboarding-results";

function resultStatus(status: string | undefined, exitCode: number | null) {
  if (status === "success") return "DONE";
  if (status === "already_onboarded") return "ALREADY_ONBOARDED";
  if (exitCode === 0) return "DONE";
  return "FAILED";
}

function safeNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function warningsJson(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function boundedText(value: string | undefined | null, max = 4000): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function boundedJson(value: unknown) {
  if (value == null) return undefined;
  try {
    const json = JSON.stringify(value);
    if (json.length <= 16000) return value;
    return {
      truncated: true,
      originalBytes: Buffer.byteLength(json),
      preview: json.slice(0, 16000),
    };
  } catch {
    return { unserializable: true, value: String(value) };
  }
}

function eventText(value: unknown): string | null {
  if (typeof value === "string") return boundedText(value);
  if (!value || typeof value !== "object") return null;
  const event = value as {
    result?: unknown;
    message?: { content?: Array<{ type?: string; text?: string }> };
    content?: Array<{ type?: string; text?: string }>;
  };
  if (typeof event.result === "string") return boundedText(event.result);
  const blocks = event.message?.content ?? event.content;
  if (Array.isArray(blocks)) {
    const text = blocks
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    return boundedText(text);
  }
  return null;
}

function compactHints(hints: OnboardingHints | undefined): Record<string, string | number> {
  if (!hints) return {};
  return Object.fromEntries(
    Object.entries(hints)
      .map(([key, value]) => {
        if (typeof value === "string") return [key, value.trim()] as const;
        if (typeof value === "number" && Number.isFinite(value)) return [key, value] as const;
        return [key, ""] as const;
      })
      .filter(([, value]) => typeof value === "number" || value.length > 0),
  );
}

async function cleanupFiles(...files: Array<string | null | undefined>) {
  await Promise.all(files.filter(Boolean).map((file) => unlink(file as string).catch(() => undefined)));
}

export async function startOnboardingJob(jobId: string, sourceUrl: string, hints?: OnboardingHints) {
  const command = process.env.ONBOARD_COMMAND || DEFAULT_COMMAND;
  const resultDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.ONBOARD_RESULT_DIR || DEFAULT_RESULT_DIR);
  const resultPath = path.join(resultDir, `${jobId}.json`);
  const hintsPayload = compactHints(hints);
  const hintsPath = Object.keys(hintsPayload).length ? path.join(resultDir, `${jobId}.hints.json`) : null;

  await mkdir(resultDir, { recursive: true });
  if (hintsPath) {
    await writeFile(hintsPath, JSON.stringify(hintsPayload, null, 2), "utf8");
  }
  const startedAt = new Date();
  await prisma.onboardingJob.update({ where: { id: jobId }, data: { status: "PROCESSING", startedAt } });

  const child = spawn(command, hintsPath ? [sourceUrl, resultPath, hintsPath] : [sourceUrl, resultPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let sequence = 0;
  const pendingEvents = new Set<Promise<unknown>>();
  const rememberEvent = (promise: Promise<unknown>) => {
    pendingEvents.add(promise);
    promise.finally(() => pendingEvents.delete(promise)).catch(() => undefined);
  };
  const writeEvent = (stream: "stdout" | "stderr" | "system", lineOrEvent: string | unknown) => {
    const now = new Date();
    const parsed = typeof lineOrEvent === "string" ? tryParseJson(lineOrEvent) : lineOrEvent;
    const event =
      parsed && typeof parsed === "object"
        ? (parsed as { type?: unknown; subtype?: unknown; level?: unknown })
        : undefined;
    const text = typeof lineOrEvent === "string" && !event ? boundedText(lineOrEvent) : eventText(parsed);
    const promise = prisma.$transaction([
      prisma.onboardingJobEvent.create({
        data: {
          jobId,
          sequence: ++sequence,
          stream,
          type: typeof event?.type === "string" ? event.type : null,
          subtype: typeof event?.subtype === "string" ? event.subtype : null,
          level: typeof event?.level === "string" ? event.level : stream === "stderr" ? "error" : null,
          text,
          data: boundedJson(parsed),
          createdAt: now,
        },
      }),
      prisma.onboardingJob.update({
        where: { id: jobId },
        data: { eventCount: { increment: 1 }, lastEventAt: now },
      }),
    ]);
    rememberEvent(promise.catch(() => undefined));
  };

  const attachLineReader = (stream: Readable | null, name: "stdout" | "stderr") => {
    if (!stream) return;
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) writeEvent(name, line);
      }
    });
    stream.on("end", () => {
      if (buffer.trim()) writeEvent(name, buffer);
    });
  };

  writeEvent("system", { type: "job_started", sourceUrl, resultPath, hintsPath });
  attachLineReader(child.stdout, "stdout");
  attachLineReader(child.stderr, "stderr");

  child.once("error", async (error) => {
    const finishedAt = new Date();
    writeEvent("system", { type: "spawn_error", error: error.message });
    await Promise.allSettled([...pendingEvents]);
    await prisma.onboardingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: error.message, finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime() },
    });
    await cleanupFiles(hintsPath);
  });

  child.once("exit", async (code) => {
    const finishedAt = new Date();
    writeEvent("system", { type: "job_exited", exitCode: code });
    await Promise.allSettled([...pendingEvents]);
    try {
      const raw = await readFile(/*turbopackIgnore: true*/ resultPath, "utf8");
      const result = JSON.parse(raw) as OnboardingResult;
      const resolvedAddress = typeof result.address === "string" && result.address.trim() ? result.address.trim() : null;
      const resolvedLat = safeNumber(result.lat ?? result.latitude);
      const resolvedLng = safeNumber(result.lng ?? result.longitude);
      await prisma.onboardingJob.update({
        where: { id: jobId },
        data: {
          status: resultStatus(result.status, code),
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          exitCode: code,
          accountUid: result.ownerId ?? null,
          loginEmail: result.email ?? null,
          loginPassword: result.password ? encrypt(result.password) : null,
          sourceType: result.sourceType ?? null,
          serviceCount: safeNumber(result.serviceCount),
          agentCount: safeNumber(result.agentCount),
          videoCount: safeNumber(result.videoCount),
          warnings: warningsJson(result.warnings),
          error: result.error ?? (code === 0 ? null : `onboarding command exited with code ${code}`),
        },
      });
      const salonData: { address?: string; lat?: number; lng?: number } = {};
      if (resolvedAddress) salonData.address = resolvedAddress;
      if (resolvedLat != null && resolvedLng != null) {
        salonData.lat = resolvedLat;
        salonData.lng = resolvedLng;
      }
      if (Object.keys(salonData).length > 0) {
        const job = await prisma.onboardingJob.findUnique({ where: { id: jobId }, select: { salonId: true } });
        if (job) await prisma.salon.update({ where: { id: job.salonId }, data: salonData });
      }
      await cleanupFiles(resultPath, hintsPath);
    } catch (error) {
      await prisma.onboardingJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          exitCode: code,
          error: error instanceof Error ? error.message : "Failed to read onboarding result",
        },
      });
      await cleanupFiles(resultPath, hintsPath);
    }
  });
}

function tryParseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
