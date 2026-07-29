/**
 * Turns the images of an HTML email into inline parts at send time.
 *
 * A remote `<img>` is a fetch the recipient's client may refuse; an inline part
 * is not, so it renders even when remote images are blocked. Doing it here — on
 * the way out, not in the stored template — keeps `EmailJob.body` readable as
 * the markup an operator actually composed.
 *
 * Best-effort by contract: anything that cannot be fetched, is too big, or
 * lives off the allowlist is left exactly as it was. A template with an image
 * we cannot inline still goes out; it just depends on the client, which is no
 * worse than not trying.
 */

import { createHash } from "node:crypto";
import { classifyImageSource, extractImageSources, isInlinable } from "@/lib/emailImages";

/** Caps: a salon email is not a photo album, and the worker is sequential. */
const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 6_000;

export type InlineAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
  contentDisposition: "inline";
};

export type InlineResult = { html: string; attachments: InlineAttachment[]; skipped: number };

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** Stable per source, so the same image reused twice becomes one part. */
function cidFor(src: string): string {
  return `img-${createHash("sha1").update(src).digest("hex").slice(0, 16)}@glaura`;
}

function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType.toLowerCase()] ?? "img";
}

function decodeDataUri(src: string): { content: Buffer; contentType: string } | null {
  // `[\s\S]` rather than the dotAll flag: the tsconfig target predates it.
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(src.trim());
  if (!match) return null;
  const content = Buffer.from(match[2], "base64");
  if (!content.length || content.length > MAX_IMAGE_BYTES) return null;
  return { content, contentType: match[1].toLowerCase() };
}

async function download(src: string): Promise<{ content: Buffer; contentType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(src, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return null;
    // Trust the header when it is there, and re-check the real length after: a
    // missing/lying content-length must not let an unbounded body through.
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) return null;

    const content = Buffer.from(await response.arrayBuffer());
    if (!content.length || content.length > MAX_IMAGE_BYTES) return null;
    return { content, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rewrites every inlinable `<img src>` to a `cid:` reference and returns the
 * matching parts. `skipped` counts the sources left remote, for logging.
 */
export async function inlineEmailImages(html: string): Promise<InlineResult> {
  const sources = extractImageSources(html);
  const attachments: InlineAttachment[] = [];
  let rewritten = html;
  let total = 0;
  let skipped = 0;

  for (const src of sources) {
    if (!isInlinable(classifyImageSource(src))) {
      skipped += 1;
      continue;
    }
    if (attachments.length >= MAX_IMAGES) {
      skipped += 1;
      continue;
    }

    const loaded = src.startsWith("data:") ? decodeDataUri(src) : await download(src);
    if (!loaded || total + loaded.content.length > MAX_TOTAL_BYTES) {
      skipped += 1;
      continue;
    }

    const cid = cidFor(src);
    total += loaded.content.length;
    attachments.push({
      filename: `${cid.split("@")[0]}.${extensionFor(loaded.contentType)}`,
      content: loaded.content,
      contentType: loaded.contentType,
      cid,
      contentDisposition: "inline",
    });
    // Split/join rather than a regex: the source came out of this very string,
    // and a data URI is full of characters a pattern would have to escape.
    rewritten = rewritten.split(src).join(`cid:${cid}`);
  }

  return { html: rewritten, attachments, skipped };
}
