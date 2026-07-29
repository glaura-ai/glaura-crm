/**
 * Hosting for images used in email templates.
 *
 * An email needs an absolute URL for every image, and a template author has
 * nowhere to put one — pasting a design-tool export leaves either base64 blobs
 * or links that expire. This uploads into the same EU media bucket the salon
 * photos use (src/lib/onboarding/images.ts), which is publicly readable at the
 * bucket level and on the `EMAIL_IMAGE_HOSTS` allowlist, so the send path can
 * fetch the image back and inline it.
 *
 * Unlike the salon re-host, the original format is preserved: a logo flattened
 * to JPEG would lose its transparency and sit on a white square in the email.
 */

import { getMediaBucket, MEDIA_BUCKET } from "@/lib/firebase-admin";
import { IMAGE_EXTENSIONS, MAX_EMAIL_IMAGE_BYTES } from "@/lib/emailImages";

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
  const storagePath = `email_assets/${now}-${safeStem(file.name)}.${IMAGE_EXTENSIONS[contentType]}`;
  await getMediaBucket()
    .file(storagePath)
    .save(content, {
      resumable: false,
      contentType,
      metadata: { cacheControl: "public, max-age=31536000", metadata: { uploadedBy: "crm-email-templates" } },
    });

  return { url: `https://storage.googleapis.com/${MEDIA_BUCKET}/${storagePath}`, bytes: content.length };
}
