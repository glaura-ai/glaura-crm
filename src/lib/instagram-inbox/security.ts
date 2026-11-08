import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyMetaSignature(body: string, signature: string | null, secret: string | undefined) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export function instagramReplyAllowed(lastInboundAt: Date | null, now = new Date()) {
  if (!lastInboundAt) return false;
  const elapsed = now.getTime() - lastInboundAt.getTime();
  return elapsed >= 0 && elapsed < 24 * 60 * 60 * 1000;
}
