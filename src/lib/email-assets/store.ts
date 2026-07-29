/**
 * Hosting for images used in email templates.
 *
 * An email needs an absolute URL for every image, and a template author has
 * nowhere to put one — pasting a design-tool export leaves either base64 blobs
 * or links that expire. This uploads into the same EU media bucket the salon
 * photos use (src/lib/onboarding/images.ts).
 *
 * TWO THINGS THAT LOOK ARBITRARY AND ARE NOT:
 *
 * 1. The object goes under `images/email/`. The EU bucket uses uniform
 *    bucket-level access and is NOT public on storage.googleapis.com (it 403s);
 *    images.glaura.ai reaches it through the Firebase download API, which
 *    enforces goglow-firebase/storage.rules. Those grant `allow read: if true`
 *    per prefix, and `match /images/{folder}/{fileName}` covers any folder — so
 *    this prefix is readable without a rules deploy, where `email_assets/`
 *    silently was not.
 * 2. The returned URL is the CDN one, for the same reason: the direct GCS URL
 *    would 403 for the sender fetching it back, and for the editor preview.
 *
 * Unlike the salon re-host, the original format is preserved: a logo flattened
 * to JPEG would lose its transparency and sit on a white square in the email.
 */

import { getMediaBucket } from "@/lib/firebase-admin";
import { IMAGE_EXTENSIONS, MAX_EMAIL_IMAGE_BYTES } from "@/lib/emailImages";

/** Folder under the rules-public `images/` prefix. */
const EMAIL_IMAGE_PREFIX = "images/email";
/** The CDN in front of the bucket — see cloudflare-workers/images-proxy. */
const IMAGE_CDN_ORIGIN = "https://images.glaura.ai";

/** Keeps an object name predictable and free of anything path-like. */
function safeStem(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").toLowerCase();
  return (stem.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "image").slice(0, 40);
}

export type UploadedEmailImage = { url: string; bytes: number };

/**
 * Stores one image and returns its public URL. Throws with a message meant for
 * the operator — the caller surfaces it verbatim in the editor.
 */
export async function storeEmailImage(
  file: { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> },
  now: number,
): Promise<UploadedEmailImage> {
  const contentType = file.type.toLowerCase();
  if (!IMAGE_EXTENSIONS[contentType]) {
    throw new Error("Format non supporté — PNG, JPEG, GIF ou WebP uniquement");
  }
  if (file.size > MAX_EMAIL_IMAGE_BYTES) {
    throw new Error(`Image trop lourde (${Math.round(file.size / 1024)} Ko) — 2 Mo maximum`);
  }

  const content = Buffer.from(await file.arrayBuffer());
  if (!content.length) throw new Error("Fichier vide");
  if (content.length > MAX_EMAIL_IMAGE_BYTES) {
    throw new Error("Image trop lourde — 2 Mo maximum");
  }

  // `now` is injected so the path is unique per upload without this module
  // reaching for the clock: same input, same object name.
  const storagePath = `${EMAIL_IMAGE_PREFIX}/${now}-${safeStem(file.name)}.${IMAGE_EXTENSIONS[contentType]}`;
  await getMediaBucket()
    .file(storagePath)
    .save(content, {
      resumable: false,
      contentType,
      metadata: { cacheControl: "public, max-age=31536000", metadata: { uploadedBy: "crm-email-templates" } },
    });

  return { url: `${IMAGE_CDN_ORIGIN}/${storagePath}`, bytes: content.length };
}
