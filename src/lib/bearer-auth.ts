// Shared-secret bearer check for the service-to-service endpoints (leads,
// self-serve, transactional email). Extracted so every caller gets the same
// constant-time comparison rather than its own re-implementation.

import { timingSafeEqual } from "node:crypto";

/** Constant-time bearer check. Returns false when unconfigured, so a missing
 *  secret closes the endpoint instead of opening it. */
export function isBearerAuthorized(
  authorizationHeader: string | null | undefined,
  secret: string | undefined,
): boolean {
  const expected = secret?.trim();
  if (!expected) return false;
  const header = authorizationHeader ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // Length must match before timingSafeEqual, which throws on a mismatch.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
