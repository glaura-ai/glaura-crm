/**
 * Authoritative SSRF guard for the user-supplied booking URL.
 *
 * `bookingUrl` originates from a public, unauthenticated form and is fetched
 * server-side by expandSalonPage (Playwright). Without this, a caller could
 * point it at cloud/VPS metadata (169.254.169.254), loopback, or internal
 * RFC1918 hosts. This resolves the hostname's DNS and rejects the fetch if ANY
 * resolved address is private/reserved — run right before navigation.
 *
 * Residual risk: DNS rebinding between this check and Chromium's own resolution
 * is not fully closed here (would need IP-pinning at the network layer); this
 * blocks literal-IP and static-private-hostname attacks, the common cases.
 * See the pre-deploy security review.
 */

import { lookup } from "node:dns/promises";
import net from "node:net";

/** True for IPv4/IPv6 addresses in loopback/private/link-local/reserved space. */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local incl. metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast + reserved
    );
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
    if (mapped) return isPrivateOrReservedIp(mapped[1]);
    return false;
  }
  return true; // not a valid IP → reject
}

/** Throws if `raw` is not an http(s) URL whose host resolves only to public IPs. */
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("SSRF guard: invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`SSRF guard: blocked scheme ${u.protocol}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) throw new Error(`SSRF guard: blocked IP literal ${host}`);
    return;
  }

  let results: Array<{ address: string }>;
  try {
    results = await lookup(host, { all: true });
  } catch {
    throw new Error(`SSRF guard: DNS resolution failed for ${host}`);
  }
  if (results.length === 0) throw new Error(`SSRF guard: no DNS records for ${host}`);
  for (const { address } of results) {
    if (isPrivateOrReservedIp(address)) {
      throw new Error(`SSRF guard: ${host} resolves to blocked address ${address}`);
    }
  }
}
