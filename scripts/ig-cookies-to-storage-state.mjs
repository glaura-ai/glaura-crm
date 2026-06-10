#!/usr/bin/env node
// Convert a Netscape cookies.txt jar into a Playwright storage-state JSON,
// keeping ONLY instagram.com cookies. Used by run-onboard.sh to launch the
// headless onboarding browser already authenticated to Instagram, so reel
// pulls aren't bounced to the login wall. We filter to instagram.com on
// purpose — the source jar is a full-browser export and must not leak
// unrelated session cookies (Cloudflare, etc.) into the scraping browser.
//
// Usage: node ig-cookies-to-storage-state.mjs <cookies.txt> <out-storage-state.json>
import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("usage: ig-cookies-to-storage-state.mjs <cookies.txt> <out.json>");
  process.exit(2);
}

const raw = readFileSync(inputPath, "utf8");
const cookies = [];

for (const line of raw.split(/\r?\n/)) {
  if (!line.trim()) continue;

  // Netscape format marks HttpOnly cookies with a "#HttpOnly_" domain prefix;
  // other "#" lines are comments.
  let httpOnly = false;
  let work = line;
  if (work.startsWith("#HttpOnly_")) {
    httpOnly = true;
    work = work.slice("#HttpOnly_".length);
  } else if (work.startsWith("#")) {
    continue;
  }

  const cols = work.split("\t");
  if (cols.length < 7) continue;

  const [domain, , path, secure, expiry, name, ...valueParts] = cols;
  if (!/instagram\.com$/i.test(domain.replace(/^\./, ""))) continue;

  const value = valueParts.join("\t");
  const expires = Number(expiry) > 0 ? Number(expiry) : -1;

  cookies.push({
    name,
    value,
    domain,
    path: path || "/",
    expires,
    httpOnly,
    secure: secure.toUpperCase() === "TRUE",
    sameSite: "Lax",
  });
}

if (cookies.length === 0) {
  console.error(`no instagram.com cookies found in ${inputPath}`);
  process.exit(1);
}
if (!cookies.some((c) => c.name === "sessionid" && c.value)) {
  console.error("instagram cookies present but no usable sessionid — session likely expired");
  process.exit(1);
}

writeFileSync(outputPath, JSON.stringify({ cookies, origins: [] }), "utf8");
console.error(`wrote ${cookies.length} instagram cookies to ${outputPath}`);
