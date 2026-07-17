// Pure matching helpers for CRM dedup (no Prisma import — unit-testable).

export type ProspectMatchInput = {
  name: string;
  sourceUrl: string;
  postalCode: string | null;
};

export type CrmIndex = {
  byBookingUrl: Map<string, string>; // normalized booking url -> salonId
  byNamePostal: Map<string, string>; // normName|postal -> salonId
};

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function normalizeBookingUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return null;
  }
}

// Salon.arrondissement is free text: "75011", "11", "11e", "Paris 11e", zone
// labels… Derive a 5-digit postal code when possible so name+postal dedup
// covers the common formats.
export function postalFromArrondissement(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d{5}$/.test(trimmed)) return trimmed;
  const arrondissement = trimmed.match(/^(?:paris\s*)?(\d{1,2})\s*(?:e|er|eme|ème)?(?:\s*arr(?:ondissement)?\.?)?$/i);
  if (arrondissement) {
    const n = Number(arrondissement[1]);
    if (n >= 1 && n <= 20) return `750${String(n).padStart(2, "0")}`;
  }
  return null;
}

export function matchCrmSalon(prospect: ProspectMatchInput, index: CrmIndex): string | null {
  const url = normalizeBookingUrl(prospect.sourceUrl);
  if (url) {
    const byUrl = index.byBookingUrl.get(url);
    if (byUrl) return byUrl;
  }
  if (prospect.postalCode) {
    const byName = index.byNamePostal.get(`${normalizeName(prospect.name)}|${prospect.postalCode}`);
    if (byName) return byName;
  }
  return null;
}
