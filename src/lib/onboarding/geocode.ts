/**
 * Best-effort geocoding via the French government address API
 * (https://api-adresse.data.gouv.fr). Used when a scraped salon address has
 * no coordinates attached.
 *
 * Never throws — a failed lookup (network error, timeout, malformed
 * response, no match) resolves to `null` so callers can fall back to CRM
 * hints or proceed with `spLocation: null`.
 */

import { z } from "zod";

export interface GeocodeResult {
  lat: number;
  lng: number;
}

const GEOCODE_BASE_URL = "https://api-adresse.data.gouv.fr/search/";
const GEOCODE_TIMEOUT_MS = 8000;

// GeoJSON FeatureCollection — coordinates are [lng, lat] per the spec. Kept
// loose (no full schema) since we only need the first feature's coordinates.
const GeocodeResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z
          .object({
            coordinates: z.tuple([z.number(), z.number()]).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export async function geocode(address: string): Promise<GeocodeResult | null> {
  const trimmed = address?.trim();
  if (!trimmed) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

  try {
    const url = `${GEOCODE_BASE_URL}?limit=1&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const json: unknown = await response.json();
    const parsed = GeocodeResponseSchema.safeParse(json);
    if (!parsed.success) return null;

    const coordinates = parsed.data.features?.[0]?.geometry?.coordinates;
    if (!coordinates) return null;

    const [lng, lat] = coordinates;
    return { lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
