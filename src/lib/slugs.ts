import { prisma } from "@/lib/db";

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Bounded so a pathological name can never spin forever. 500 matches the
// self-serve onboarding reservation limit.
const MAX_SLUG_ATTEMPTS = 500;

export async function uniqueSalonSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || "salon";
  for (let i = 0; i <= MAX_SLUG_ATTEMPTS; i++) {
    const slug = i === 0 ? base : `${base}-${i}`;
    const existing = await prisma.salon.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
  }
  throw new Error(`Impossible de générer un slug unique pour « ${name} » après ${MAX_SLUG_ATTEMPTS} tentatives.`);
}

/**
 * Stable key for a new email template, derived from its label. Assigned once at
 * creation and never updated — EmailJob rows snapshot it, so a later rename must
 * not change what past sends point at.
 */
export async function uniqueEmailTemplateKey(label: string): Promise<string> {
  const base = slugify(label) || "modele";
  for (let i = 0; i <= MAX_SLUG_ATTEMPTS; i++) {
    const key = i === 0 ? base : `${base}-${i}`;
    const existing = await prisma.emailTemplate.findUnique({ where: { key } });
    if (!existing) return key;
  }
  throw new Error(`Impossible de générer une clé unique pour « ${label} » après ${MAX_SLUG_ATTEMPTS} tentatives.`);
}
