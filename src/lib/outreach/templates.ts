import { createHmac } from "node:crypto";
import { whatsappOutreachConfig } from "./config";

export type TemplateStatus = "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "MISSING";
const KNOWN = new Set<TemplateStatus>(["APPROVED", "PENDING", "REJECTED", "PAUSED"]);
// A template can exist in several languages: the most usable status wins.
const RANK: Record<TemplateStatus, number> = { APPROVED: 4, PENDING: 3, PAUSED: 2, REJECTED: 1, MISSING: 0 };

/**
 * Meta review status of WhatsApp templates by name (WABA from WHATSAPP_OUTREACH_WABA_ID).
 * Returns null when not configured or when Meta cannot be reached. Never throws, never logs the token.
 */
export async function fetchTemplateStatuses(names: string[]): Promise<Record<string, TemplateStatus> | null> {
  const config = whatsappOutreachConfig();
  const waba = process.env.WHATSAPP_OUTREACH_WABA_ID?.trim();
  if (!config || !waba) return null;
  try {
    const url = new URL(`https://graph.facebook.com/${config.version}/${waba}/message_templates`);
    url.searchParams.set("fields", "name,status");
    url.searchParams.set("limit", "200");
    const secret = process.env.META_APP_SECRET?.trim();
    if (secret) url.searchParams.set("appsecret_proof", createHmac("sha256", secret).update(config.token).digest("hex"));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${config.token}` }, cache: "no-store", signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!response.ok) return null;
    const body = await response.json() as { data?: { name?: unknown; status?: unknown }[] };
    const found: Record<string, TemplateStatus> = {};
    for (const row of Array.isArray(body.data) ? body.data : []) {
      if (typeof row?.name !== "string" || typeof row.status !== "string") continue;
      const status = (KNOWN.has(row.status as TemplateStatus) ? row.status : "PAUSED") as TemplateStatus;
      if (!found[row.name] || RANK[status] > RANK[found[row.name]]) found[row.name] = status;
    }
    return Object.fromEntries(names.map(n => [n, found[n] ?? "MISSING"]));
  } catch {
    return null;
  }
}
