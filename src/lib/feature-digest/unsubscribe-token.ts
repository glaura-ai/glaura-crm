import { createHmac, timingSafeEqual } from "node:crypto";

function signature(providerId: string, secret: string): string {
  return createHmac("sha256", secret).update(providerId).digest("base64url");
}

/** `providerId.sig` — the CRM both signs and verifies, so the secret never leaves it. */
export function signUnsubscribeToken(providerId: string, secret: string): string {
  if (!secret) throw new Error("SALON_DIGEST_UNSUB_SECRET manquant");
  if (!providerId || providerId.includes(".")) throw new Error("providerId invalide");
  return `${providerId}.${signature(providerId, secret)}`;
}

/** Returns the provider id when the token is authentic, otherwise null. */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [providerId, sig] = parts;
  const expected = Buffer.from(signature(providerId, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return providerId;
}
