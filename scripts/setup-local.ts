import "dotenv/config";
import { execFileSync } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Cette commande est réservée au développement local.");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("La base doit être locale. Aucun serveur distant ne sera modifié.");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (database !== "glaura_crm") throw new Error("La base de développement attendue est glaura_crm.");
  const container = "glaura-crm-dev-db";
  execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore", timeout: 15000 });
  const env = { ...process.env, POSTGRES_USER: decodeURIComponent(url.username), POSTGRES_PASSWORD: decodeURIComponent(url.password), POSTGRES_DB: database };
  let exists = false;
  try { execFileSync("docker", ["container", "inspect", container], { stdio: "ignore" }); exists = true; } catch { /* first setup */ }
  if (exists) execFileSync("docker", ["start", container], { stdio: "inherit" });
  else execFileSync("docker", ["run", "--detach", "--name", container, "--publish", `127.0.0.1:${url.port || "5432"}:5432`, "--env", "POSTGRES_USER", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB", "--volume", "glaura-crm-dev-data:/var/lib/postgresql/data", "postgres:16-alpine"], { env, stdio: "inherit" });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { execFileSync("docker", ["exec", container, "pg_isready", "-U", env.POSTGRES_USER, "-d", database], { stdio: "ignore" }); ready = true; break; } catch { await pause(500); }
  }
  if (!ready) throw new Error("La base locale n’est pas encore disponible.");
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
  const { prisma } = await import("../src/lib/db");
  const existingSalons = await prisma.salon.count();
  await prisma.$disconnect();
  if (existingSalons === 0) execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "inherit", env: process.env });
  console.log("Base locale prête. Utilisez « Connexion dev » sur http://127.0.0.1:3000/login.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Préparation locale impossible."); process.exitCode = 1; });
