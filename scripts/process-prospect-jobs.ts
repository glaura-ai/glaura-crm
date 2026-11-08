import { loadEnvConfig } from "@next/env";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
loadEnvConfig(process.cwd());

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { ZONE_BY_SLUG } = await import("../src/lib/prospection/zones");
  const scripts: Record<string, string> = { DIRECTORIES: "scripts/prospect-sweep.ts", GOOGLE: "scripts/prospect-enrich-google.ts", INSTAGRAM: "scripts/prospect-enrich-ig.ts" };
  do {
    await prisma.prospectRun.updateMany({ where: { status: "PROCESSING", heartbeatAt: { lt: new Date(Date.now() - 5 * 60000) } }, data: { status: "FAILED", finishedAt: new Date(), summary: "Le service a été interrompu. Les résultats déjà enregistrés sont conservés ; un nouveau traitement peut être lancé." } });
    const run = await prisma.prospectRun.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
    if (!run) { if (!process.argv.includes("--loop")) break; await pause(15000); continue; }
    const claimed = await prisma.prospectRun.updateMany({ where: { id: run.id, status: "QUEUED" }, data: { status: "PROCESSING", startedAt: new Date(), heartbeatAt: new Date() } });
    if (!claimed.count) continue;
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      if ((!scripts[run.kind] && !["GOOGLE_DISCOVERY", "INSTAGRAM_DISCOVERY", "TREATWELL_PLANITY"].includes(run.kind)) || !ZONE_BY_SLUG.has(run.zone)) throw new Error("Paramètres invalides");
      timer = setInterval(() => { void prisma.prospectRun.update({ where: { id: run.id }, data: { heartbeatAt: new Date() } }).catch(() => {}); }, 30000);
      if (run.kind === "TREATWELL_PLANITY") {
        const { pullTreatwellPlanity } = await import("../src/lib/prospection/treatwell-planity");
        const summary = await pullTreatwellPlanity(run.zone, run.limit);
        await prisma.prospectRun.update({ where: { id: run.id }, data: { status: "DONE", finishedAt: new Date(), summary } });
        continue;
      }
      if (["GOOGLE_DISCOVERY", "INSTAGRAM_DISCOVERY"].includes(run.kind)) {
        const { discoverLeads } = await import("../src/lib/prospection/discover");
        const summary = await discoverLeads(run);
        await prisma.prospectRun.update({ where: { id: run.id }, data: { status: "DONE", finishedAt: new Date(), summary } });
        continue;
      }
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", scripts[run.kind], `--zone=${run.zone}`, `--limit=${run.limit}`], { env: process.env, stdio: ["ignore", "pipe", "pipe"], timeout: 40 * 60000 });
        let tail = "";
        child.stdout.on("data", chunk => { tail = (tail + chunk.toString()).slice(-4000); });
        // Provider errors can contain tokens or infrastructure details: keep them out of the CRM.
        child.stderr.on("data", () => {});
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolve(tail) : reject(new Error("Traitement interrompu")));
      });
      const summary = output.split("\n").filter(l => /terminé|upsert:/.test(l)).slice(-2).join("\n") || "Traitement terminé. Les résultats sont disponibles dans la base de prospects.";
      await prisma.prospectRun.update({ where: { id: run.id }, data: { status: "DONE", finishedAt: new Date(), summary } });
    } catch {
      await prisma.prospectRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), summary: "Le traitement n’a pas abouti. Vérifiez la connexion du fournisseur et les journaux du service. Les résultats déjà enregistrés sont conservés." } });
    } finally { if (timer) clearInterval(timer); }
  } while (true);
  await prisma.$disconnect();
}
main().catch(() => { console.error("Le service de prospection a rencontré une erreur."); process.exitCode = 1; });
