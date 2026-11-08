"use server";
import { z } from "zod";
import { requireAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { ZONE_BY_SLUG } from "@/lib/prospection/zones";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function queueProspectRun(fd: FormData) {
  const user = await requireAdmin();
  let error: string | null = null;
  try {
    const d = z.object({ kind: z.enum(["DIRECTORIES", "GOOGLE", "INSTAGRAM", "GOOGLE_DISCOVERY", "INSTAGRAM_DISCOVERY", "TREATWELL_PLANITY"]), zone: z.string(), query: z.string().trim().max(2000).optional(), limit: z.coerce.number().int().min(1).max(200) }).parse(Object.fromEntries(fd));
    if (!ZONE_BY_SLUG.has(d.zone)) throw new Error("Zone inconnue.");
    if (["GOOGLE", "GOOGLE_DISCOVERY"].includes(d.kind) && !process.env.GOOGLE_PLACES_KEY) throw new Error("La connexion Google doit être configurée avant de lancer ce traitement.");
    if (["INSTAGRAM", "INSTAGRAM_DISCOVERY"].includes(d.kind) && !(process.env.IG_GRAPH_TOKEN && process.env.IG_GRAPH_USER_ID)) throw new Error("La connexion Instagram doit être configurée avant de lancer ce traitement.");
    if (d.kind === "INSTAGRAM_DISCOVERY" && !d.query) throw new Error("Indiquez les comptes Instagram à importer.");
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(811082026)`;
      if (await tx.prospectRun.findFirst({ where: { kind: d.kind, zone: d.zone, status: { in: ["QUEUED", "PROCESSING"] } } })) throw new Error("Un traitement identique est déjà en attente ou en cours pour cette zone.");
      await tx.prospectRun.create({ data: { ...d, requestedById: user.id } });
    });
  } catch (e) { error = e instanceof z.ZodError ? "Vérifiez les paramètres du traitement." : e instanceof Error ? e.message : "Impossible de lancer le traitement."; }
  revalidatePath("/prospection");
  redirect(`/prospection?tab=runs${error ? `&error=${encodeURIComponent(error)}` : ""}`);
}
