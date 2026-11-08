export type ProfileDoc = { id: string; data: Record<string, unknown> };

export type DigestRecipient = { providerId: string; email: string; salonName: string };

const SALON_ROLE = 2;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_DOMAIN = "@glaura.fr";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Pure filter: salons with a real email who have not opted out of announcements. */
export function selectRecipients(docs: readonly ProfileDoc[]): DigestRecipient[] {
  const seen = new Set<string>();
  const out: DigestRecipient[] = [];
  for (const { id, data } of docs) {
    if (data.userRole !== SALON_ROLE) continue;
    const email = str(data.email).toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email.endsWith(PLACEHOLDER_DOMAIN)) continue;
    const announcements = data.featureAnnouncements as { emailOptOut?: unknown } | undefined;
    if (announcements?.emailOptOut === true) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ providerId: id, email, salonName: str(data.companyName) });
  }
  return out;
}
