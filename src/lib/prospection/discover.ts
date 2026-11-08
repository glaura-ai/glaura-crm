import { prisma } from "@/lib/db";
import { businessDiscovery, igGraphConfig } from "./ig-graph";
import { loadCrmIndex } from "./upsert";
import { matchCrmSalon, normalizeName } from "./match";
import { ZONE_BY_SLUG, zoneForPostalCode } from "./zones";
import { tierForProspect } from "./tier";
import { normalizeInstagramHandle } from "@/lib/instagram";
import type { ProspectRun } from "@/generated/prisma/client";
import { setTimeout as pause } from "node:timers/promises";

type Discovered = { name: string; source: "GOOGLE" | "INSTAGRAM"; sourceUrl: string; zone: string; address?: string; postalCode?: string; googlePlaceId?: string; instagram?: string; instagramFollowers?: number | null };
async function saveDiscovered(lead: Discovered) {
  const index = await loadCrmIndex();
  let matchedSalonId = matchCrmSalon({ ...lead, postalCode: lead.postalCode ?? null }, index);
  if (!matchedSalonId && lead.instagram) matchedSalonId = (await prisma.salon.findFirst({ where: { instagram: lead.instagram }, select: { id: true } }))?.id ?? null;
  const candidates = await prisma.prospect.findMany({ where: { OR: [{ sourceUrl: lead.sourceUrl }, ...(lead.googlePlaceId ? [{ googlePlaceId: lead.googlePlaceId }] : []), ...(lead.instagram ? [{ instagram: lead.instagram }] : []), ...(lead.postalCode ? [{ postalCode: lead.postalCode }] : [])] }, select: { id: true, sourceUrl: true, name: true, postalCode: true, googlePlaceId: true, instagram: true } });
  const existing = candidates.find(p => p.sourceUrl === lead.sourceUrl || (lead.googlePlaceId && p.googlePlaceId === lead.googlePlaceId) || (lead.instagram && p.instagram === lead.instagram) || (lead.postalCode && p.postalCode === lead.postalCode && normalizeName(p.name) === normalizeName(lead.name)));
  if (existing) {
    await prisma.prospect.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), ...(lead.googlePlaceId ? { googlePlaceId: lead.googlePlaceId, googleStatus: "TROUVE", googleCheckedAt: new Date() } : {}), ...(lead.instagram ? { instagram: lead.instagram, instagramFollowers: lead.instagramFollowers, igStatus: "CONFIRME", igCheckedAt: new Date(), tier: tierForProspect(lead) } : {}) } });
    return false;
  }
  await prisma.prospect.create({ data: { ...lead, status: matchedSalonId ? "DEJA_CRM" : "NOUVEAU", matchedSalonId, tier: tierForProspect(lead), ...(lead.googlePlaceId ? { googleStatus: "TROUVE", googleCheckedAt: new Date() } : {}), ...(lead.instagram ? { igStatus: "CONFIRME", igCheckedAt: new Date() } : {}) } });
  return true;
}

export async function discoverLeads(run: Pick<ProspectRun, "kind" | "zone" | "query" | "limit">) {
  const zone = ZONE_BY_SLUG.get(run.zone);
  if (!zone) throw new Error("Zone inconnue.");
  let created = 0; let refreshed = 0;
  if (run.kind === "GOOGLE_DISCOVERY") {
    const key = process.env.GOOGLE_PLACES_KEY;
    if (!key) throw new Error("Connexion Google non configurée.");
    let pageToken: string | undefined;
    let seen = 0;
    do {
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.businessStatus,nextPageToken" }, body: JSON.stringify({ textQuery: `${run.query || "salons de coiffure et instituts de beauté"} ${zone.label} France`, languageCode: "fr", regionCode: "FR", pageSize: Math.min(20, run.limit - seen), ...(pageToken ? { pageToken } : {}) }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("La collecte Google a échoué.");
      const body = await response.json() as { nextPageToken?: string; places?: { id: string; displayName?: { text?: string }; formattedAddress?: string; businessStatus?: string }[] };
      for (const place of body.places ?? []) {
        seen++;
        if (!place.displayName?.text || place.businessStatus === "CLOSED_PERMANENTLY") continue;
        const postalCode = place.formattedAddress?.match(/\b\d{5}\b/)?.[0];
        // Google search is fuzzy geographically: never silently put another town in this zone.
        if (!postalCode || !zone.postalCodes.includes(postalCode)) continue;
        const added = await saveDiscovered({ name: place.displayName.text, source: "GOOGLE", sourceUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.displayName.text)}&query_place_id=${encodeURIComponent(place.id)}`, zone: zoneForPostalCode(postalCode)?.slug ?? zone.slug, address: place.formattedAddress, postalCode, googlePlaceId: place.id });
        if (added) created++; else refreshed++;
      }
      pageToken = body.nextPageToken;
      if (!(body.places?.length)) break;
    } while (pageToken && seen < run.limit);
  } else if (run.kind === "INSTAGRAM_DISCOVERY") {
    const config = igGraphConfig();
    if (!config) throw new Error("Connexion Instagram non configurée.");
    const handles = [...new Set((run.query ?? "").split(/[\s,;]+/).filter(Boolean).map(normalizeInstagramHandle).filter((h): h is string => !!h))].slice(0, Math.min(run.limit, 50));
    if (!handles.length) throw new Error("Aucun compte Instagram valide.");
    for (const handle of handles) {
      const profile = await businessDiscovery(handle, config);
      if (profile) {
        const added = await saveDiscovered({ name: profile.fullName || profile.username, source: "INSTAGRAM", sourceUrl: `https://www.instagram.com/${profile.username}/`, zone: zone.slug, instagram: profile.username, instagramFollowers: profile.followers });
        if (added) created++; else refreshed++;
      }
      await pause(1000);
    }
  } else throw new Error("Type de collecte inconnu.");
  return `${created} nouveau(x) prospect(s), ${refreshed} fiche(s) déjà connue(s) actualisée(s).`;
}
