import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import type { BookingTool, Metier, SalonStatus, SalonType } from "../src/generated/prisma/enums";

type AirtableBase = { id: string; name: string };
type AirtableTable = { id: string; name: string };
type AirtableRecord = { id: string; createdTime: string; fields: Record<string, unknown> };

const prisma = new PrismaClient();

const token = process.env.AIRTABLE_TOKEN;
const baseIds = (process.env.AIRTABLE_BASE_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!token) throw new Error("AIRTABLE_TOKEN is required");
if (baseIds.length === 0) throw new Error("AIRTABLE_BASE_IDS is required");

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function slugify(s: string): string {
  return normalize(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "salon";
  let slug = base;
  let i = 1;
  for (;;) {
    const existing = await prisma.salon.findUnique({ where: { slug } });
    if (!existing) return slug;
    slug = `${base}-${i++}`;
  }
}

function stringField(fields: Record<string, unknown>, name: string): string | null {
  const value = fields[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(fields: Record<string, unknown>, name: string): number | null {
  const value = fields[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolField(fields: Record<string, unknown>, name: string): boolean {
  return fields[name] === true;
}

function selectValues(fields: Record<string, unknown>, name: string): string[] {
  const value = fields[name];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function dateField(fields: Record<string, unknown>, name: string): Date | null {
  const value = stringField(fields, name);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapMetiers(values: string[]): Metier[] {
  const metiers = new Set<Metier>();
  for (const raw of values.map(normalize)) {
    if (["hair", "coiffure", "balayage/couleur", "coloration"].includes(raw)) metiers.add("COIFFURE");
    else if (["nails", "manucure"].includes(raw)) metiers.add("ONGLES");
    else if (["barber", "barbier"].includes(raw)) metiers.add("BARBIER");
    else if (raw === "spa") metiers.add("SPA");
    else if (["soins", "epilation", "esthetique", "beaute du regard"].includes(raw)) metiers.add("ESTHETIQUE");
    else if (raw) metiers.add("AUTRE");
  }
  return Array.from(metiers);
}

function mapType(priority: string | null, size: string | null): SalonType | null {
  const p = priority ? normalize(priority) : "";
  if (p.includes("gros")) return "A";
  if (p.includes("moyen")) return "B";
  if (p.includes("petit")) return "C";

  const s = size ? normalize(size) : "";
  if (s.includes("salon +")) return "A";
  if (s === "salon") return "B";
  if (s.includes("solo salon")) return "C";
  if (s.includes("domicile")) return "D";
  return null;
}

function mapStatus(values: string[]): SalonStatus {
  const normalized = values.map(normalize);
  if (normalized.some((s) => ["refuse", "pas interesse"].includes(s))) return "PAS_INTERESSE";
  if (normalized.some((s) => ["signe", "client", "active", "compte cree"].includes(s))) return "SIGNE";
  if (normalized.some((s) => ["rdv planifie", "rdv pris", "contacte", "en reflexion"].includes(s))) return "INTERESSE";
  return "A_VISITER";
}

function mapBookingTool(values: string[]): BookingTool {
  const normalized = values.map(normalize);
  if (normalized.includes("planity")) return "PLANITY";
  if (normalized.includes("treatwell")) return "TREATWELL";
  if (normalized.includes("acuity")) return "ACUITY";
  if (normalized.some((s) => ["propre site", "site", "autre", "fresha", "booksy", "iara"].includes(s))) return "SITE";
  return "NONE";
}

// Owner email MUST match the email the commercial signs in with (Google OAuth),
// otherwise the import creates a separate User from the one they log in as and
// they see none of their salons. Keep in sync with ALLOWED_GOOGLE_EMAILS (auth.ts).
function ownerFromBase(baseName: string): { name: string; email: string } {
  const normalized = normalize(baseName);
  if (normalized.includes("namory")) return { name: "Namory", email: "f.namory@glaura.fr" };
  if (normalized.includes("antoine")) return { name: "Antoine", email: "a.ribeiro@glaura.fr" };
  const fallback = baseName.replace(/^crm\s+/i, "").trim() || "Commercial";
  return { name: fallback, email: `${slugify(fallback)}@glaura.fr` };
}

function postalOrZone(fields: Record<string, unknown>): string | null {
  const address = stringField(fields, "Adresse");
  const postal = address?.match(/\b\d{5}\b/)?.[0];
  return postal ?? stringField(fields, "Zone");
}

function instagramHandle(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^@/, "");
  try {
    const url = new URL(trimmed);
    const host = normalize(url.hostname);
    if (host.includes("instagram.com")) {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }
  } catch {
    // Not a URL; keep normal handle cleanup below.
  }
  return trimmed
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^@/, "") || null;
}

async function airtable<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as T & { error?: unknown };
  if (!res.ok) throw new Error(JSON.stringify(data.error ?? data));
  return data;
}

async function listRecords(baseId: string, tableId: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const path = new URLSearchParams({ pageSize: "100" });
    if (offset) path.set("offset", offset);
    const data = await airtable<{ records: AirtableRecord[]; offset?: string }>(`${baseId}/${tableId}?${path}`);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

async function baseNames(): Promise<Map<string, string>> {
  const data = await airtable<{ bases: AirtableBase[] }>("meta/bases");
  return new Map(data.bases.map((base) => [base.id, base.name]));
}

async function firstTable(baseId: string): Promise<AirtableTable> {
  const data = await airtable<{ tables: AirtableTable[] }>(`meta/bases/${baseId}/tables`);
  const table = data.tables[0];
  if (!table) throw new Error(`No table found in Airtable base ${baseId}`);
  return table;
}

async function importBase(baseId: string, baseName: string) {
  const table = await firstTable(baseId);
  const owner = ownerFromBase(baseName);
  const user = await prisma.user.upsert({
    where: { email: owner.email },
    update: { name: owner.name },
    create: { email: owner.email, name: owner.name, role: "COMMERCIAL" },
  });

  const records = await listRecords(baseId, table.id);
  let created = 0;
  let updated = 0;

  for (const record of records) {
    const fields = record.fields;
    const externalRef = `${baseId}:${record.id}`;
    const existing = await prisma.salon.findUnique({ where: { externalRef } });
    const name = stringField(fields, "Nom du salon") ?? `Salon Airtable ${record.id}`;
    const priority = stringField(fields, "Priorité");
    const size = stringField(fields, "Taille du compte");
    const status = mapStatus(selectValues(fields, "Statut pipeline"));
    const nextActionAt = dateField(fields, "Prochaine action date") ?? dateField(fields, "Date RDV");
    const appointmentAt = dateField(fields, "Date RDV");

    const data = {
      name,
      metier: mapMetiers(selectValues(fields, "Catégorie")),
      type: mapType(priority, size),
      arrondissement: postalOrZone(fields),
      address: stringField(fields, "Adresse"),
      phone: stringField(fields, "Téléphone"),
      contactName: stringField(fields, "Nom du contact"),
      contactEmail: stringField(fields, "Email"),
      instagram: instagramHandle(stringField(fields, "Instagram")),
      bookingTool: mapBookingTool(selectValues(fields, "Outil de réservation")),
      status,
      notes: stringField(fields, "Notes"),
      objection: stringField(fields, "Objection principale"),
      priorityLabel: priority,
      leadTemperature: stringField(fields, "Type de lead"),
      accountStatusLabel: stringField(fields, "Statut compte"),
      sourceLabel: stringField(fields, "Source du lead"),
      source: "AIRTABLE" as const,
      externalRef,
      airtableBaseId: baseId,
      airtableTableId: table.id,
      airtableTableName: table.name,
      airtableRecordUrl: `https://airtable.com/${baseId}/${table.id}/${record.id}`,
      assignedToId: user.id,
      nextActionAt,
      signedAt: dateField(fields, "Date de signature"),
      activatedAt: dateField(fields, "Date d'activation"),
      appointmentAt,
      clientBaseImported: boolField(fields, "Base clients importée"),
      importedClientCount: numberField(fields, "Nombre de clients importés"),
    };

    if (existing) {
      await prisma.salon.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.salon.create({ data: { ...data, slug: await uniqueSlug(name) } });
      created += 1;
    }
  }

  return { base: baseName, table: table.name, records: records.length, created, updated };
}

async function main() {
  const names = await baseNames();
  const results = [];
  for (const baseId of baseIds) {
    results.push(await importBase(baseId, names.get(baseId) ?? baseId));
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
