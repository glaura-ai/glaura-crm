export type GeocodedAddress = {
  address: string;
  lat: number;
  lng: number;
};

// Geocode a French address via the BAN (api-adresse.data.gouv.fr). Null on miss.
export async function geocodeAddress(address: string): Promise<GeocodedAddress | null> {
  try {
    const response = await fetch(`https://api-adresse.data.gouv.fr/search/?limit=1&q=${encodeURIComponent(address)}`);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      features?: Array<{
        properties?: { label?: string };
        geometry?: { coordinates?: number[] };
      }>;
    };
    const feature = data.features?.[0];
    const lng = Number(feature?.geometry?.coordinates?.[0]);
    const lat = Number(feature?.geometry?.coordinates?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      address: feature?.properties?.label?.trim() || address,
      lat,
      lng,
    };
  } catch {
    return null;
  }
}
