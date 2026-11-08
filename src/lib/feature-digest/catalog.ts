import { z } from "zod";

export const MAX_FEATURES = 3;

const featureSchema = z.object({
  id: z.string().min(1),
  publishedAt: z.string().min(1),
  titleFr: z.string().min(1),
  titleEn: z.string().min(1),
  benefitFr: z.string().min(1),
  benefitEn: z.string().min(1),
  hintFr: z.string(),
  hintEn: z.string(),
  href: z.string().min(1),
  emailImage: z
    .string()
    .url()
    .refine((u) => {
      const url = new URL(u);
      return url.protocol === "https:" && url.hostname === "images.glaura.ai";
    }, "emailImage doit être en https sur images.glaura.ai"),
  video: z.string().optional(),
  poster: z.string().optional(),
});

export const catalogSchema = z.object({
  version: z.literal(1),
  features: z.array(featureSchema),
});

export type CatalogFeature = z.infer<typeof featureSchema>;
export type Catalog = z.infer<typeof catalogSchema>;

export function pickFeatures(catalog: Catalog, ids: readonly string[]): CatalogFeature[] {
  if (ids.length === 0) throw new Error("--features requis (1 à 3 ids)");
  if (ids.length > MAX_FEATURES) throw new Error(`Maximum ${MAX_FEATURES} nouveautés par email`);
  return ids.map((id) => {
    const found = catalog.features.find((f) => f.id === id);
    if (!found) throw new Error(`Nouveauté inconnue dans le catalogue : ${id}`);
    return found;
  });
}

export async function fetchCatalog(portalBaseUrl: string): Promise<Catalog> {
  const res = await fetch(`${portalBaseUrl}/features/catalog.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`catalog.json: HTTP ${res.status}`);
  return catalogSchema.parse(await res.json());
}
