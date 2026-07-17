import { prisma } from "@/lib/db";

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function uniqueSalonSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || "salon";
  let slug = base;
  let i = 1;
  while (true) {
    const existing = await prisma.salon.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${i++}`;
  }
}
