import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[^\x00-\x7f]/g, "") // drop accents (combining marks become non-ascii after NFD)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SALONS = [
  { name: "Zazen Marais", metier: "COIFFURE", type: "A", arr: "75004", status: "SIGNE", insta: "zazen.paris", tool: "PLANITY", rating: 4.8 },
  { name: "Mary Nail Marais", metier: "ONGLES", type: "B", arr: "75003", status: "INTERESSE", insta: "marynail_paris", tool: "ACUITY", rating: 4.6 },
  { name: "Mousse Coiffure", metier: "COIFFURE", type: "B", arr: "75011", status: "A_RELANCER", insta: "mousse.paris", tool: "TREATWELL", rating: 4.4 },
  { name: "Rimane Aura", metier: "COIFFURE", type: "A", arr: "93380", status: "VISITE_FAITE", insta: "rimaneaura", tool: "ACUITY", rating: 5.0 },
  { name: "Institut Belle Rive", metier: "ESTHETIQUE", type: "B", arr: "75012", status: "A_VISITER", insta: "belleriveparis", tool: "PLANITY", rating: 4.5 },
  { name: "Barber & Co", metier: "BARBIER", type: "C", arr: "75010", status: "A_VISITER", insta: "barberandco", tool: "SITE", rating: 4.2 },
  { name: "Spa Lotus Bastille", metier: "SPA", type: "A", arr: "75011", status: "INTERESSE", insta: "lotus.spa", tool: "PLANITY", rating: 4.9 },
  { name: "Nails Factory", metier: "ONGLES", type: "C", arr: "75017", status: "PAS_INTERESSE", insta: "nailsfactory", tool: "NONE", rating: 3.9 },
  { name: "L'Atelier Coiffure", metier: "COIFFURE", type: "B", arr: "75009", status: "A_RELANCER", insta: "atelier.coiffure", tool: "TREATWELL", rating: 4.3 },
  { name: "Pure Esthetique", metier: "ESTHETIQUE", type: "A", arr: "75008", status: "A_VISITER", insta: "pure.esthetique", tool: "ACUITY", rating: 4.7 },
  { name: "Le Salon du Barbier", metier: "BARBIER", type: "B", arr: "75018", status: "VISITE_FAITE", insta: "salondubarbier", tool: "PLANITY", rating: 4.6 },
  { name: "Onglerie Chic", metier: "ONGLES", type: "D", arr: "75015", status: "A_VISITER", insta: "onglerie.chic", tool: "SITE", rating: 4.0 },
] as const;

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "dev@glaura.fr" },
    update: {},
    create: { email: "dev@glaura.fr", name: "Dev Admin", role: "ADMIN" },
  });

  for (const s of SALONS) {
    const slug = slugify(s.name);
    const salon = await prisma.salon.upsert({
      where: { slug },
      update: {},
      create: {
        name: s.name,
        slug,
        metier: [s.metier] as never,
        type: s.type as never,
        arrondissement: s.arr,
        address: `Paris ${s.arr}, France`,
        instagram: s.insta,
        bookingTool: s.tool as never,
        bookingUrl: s.tool !== "NONE" ? `https://example.com/${slug}` : null,
        rating: s.rating,
        status: s.status as never,
        assignedToId: admin.id,
        source: "MANUAL",
        lastContactedAt: s.status !== "A_VISITER" ? new Date(Date.now() - 3 * 864e5) : null,
        nextActionAt: s.status === "A_RELANCER" ? new Date(Date.now() - 1 * 864e5) : null,
      },
    });

    if (s.status !== "A_VISITER") {
      await prisma.activity.create({
        data: { salonId: salon.id, userId: admin.id, type: "APPEL", notes: "Premier contact telephonique — interesse par une demo." },
      });
    }
    if (s.status === "A_RELANCER") {
      await prisma.reminder.create({
        data: { salonId: salon.id, userId: admin.id, title: `Relancer ${s.name}`, dueAt: new Date(Date.now() - 864e5) },
      });
    }
  }

  console.log("Seeded:", SALONS.length, "salons + dev admin");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
