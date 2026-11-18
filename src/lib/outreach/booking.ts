// Per-salesperson demo booking links. Messages carry a tracked /demo/<token> link
// that redirects to the right calendar and counts the click.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { calendarUrlOf, getOutreachSettings, type OutreachSettings } from "./settings";

const tokenSchema = z.uuid();
const httpsUrl = z.url({ protocol: /^https$/ });
type Seller = { active: boolean; bookingUrl: string | null } | null | undefined;
export type BookingSequence = { conversation: { salon: { assignedTo: Seller } | null }; startedBy: Seller };

export function trackedLink(token: string, env: Record<string, string | undefined> = process.env) {
  const base = (env.CRM_PUBLIC_URL?.trim() || "https://crm.glaura.ai").replace(/\/+$/, "");
  return `${base}/demo/${token}`;
}

const sellerUrl = (u: Seller) => (u?.active && u.bookingUrl ? u.bookingUrl : null);

/** Assigned salesperson → user who started the sequence → global default. Inactive users are skipped. */
export function resolveBookingUrl(seq: BookingSequence, settings: Pick<OutreachSettings, "calendarUrl">) {
  return sellerUrl(seq.conversation.salon?.assignedTo) ?? sellerUrl(seq.startedBy) ?? calendarUrlOf(settings);
}

/** Never throws for the visitor: unknown/invalid token or non-https target → global default. */
/** Link-preview fetchers (Meta, WhatsApp, Slack…) must not count as clicks. In-app browsers do count. */
export function isPreviewBot(userAgent: string | null) {
  return !userAgent || /facebookexternalhit|facebookcatalog|meta-externalagent|WhatsApp\/|Slackbot|TelegramBot|Twitterbot|Discordbot|bot\b|crawler|spider|preview/i.test(userAgent);
}

export async function recordClickAndResolve(token: string, opts: { count?: boolean } = {}): Promise<string> {
  const settings = await getOutreachSettings();
  const fallback = calendarUrlOf(settings);
  if (!tokenSchema.safeParse(token).success) return fallback;
  const seq = await prisma.outreachSequence.findUnique({ where: { linkToken: token }, include: { conversation: { include: { salon: { include: { assignedTo: true } } } } } });
  if (!seq) return fallback;
  const startedBy = seq.startedById ? await prisma.user.findUnique({ where: { id: seq.startedById } }) : null;
  if (opts.count !== false) await prisma.outreachSequence.update({ where: { linkToken: token }, data: { linkClicks: { increment: 1 }, linkClickedAt: new Date() } });
  const url = resolveBookingUrl({ conversation: seq.conversation, startedBy }, settings);
  return httpsUrl.safeParse(url).success ? url : fallback;
}
