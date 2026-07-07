/**
 * Re-hosts external salon images (Planity/Treatwell CDN URLs) into the EU media
 * bucket so the apps + website render them.
 *
 * WHY: `cdnImageUrl` (the goglow apps' image_utils.dart) only rewrites
 * `firebasestorage.googleapis.com` / `storage.googleapis.com` hosts to the
 * images.glaura.ai CDN — an external Planity CDN URL is passed through and does
 * NOT render in the salon page. Every live salon stores Firebase/GCS URLs, and
 * `salon_images` is read as an ARRAY (`List<String>.from`), not a comma-joined
 * string. So onboarding must download each image and upload it to the EU bucket
 * ([MEDIA_BUCKET] = glaura-user-media-eu), matching
 * goglow-firebase/functions/helpers/uploadSalonImages.js but on the EU bucket
 * the apps migrated to (user_media_storage.dart).
 *
 * Returns public `https://storage.googleapis.com/<bucket>/<path>` URLs, which
 * cdnImageUrl maps to `https://images.glaura.ai/<path>`.
 */

import { getMediaBucket, MEDIA_BUCKET } from "@/lib/firebase-admin";

/** Cap on how many gallery images we re-host per salon. */
const MAX_IMAGES = 12;

export interface RehostedImages {
  /** Main picture (its own `profile_images/` object), or "" when none hosted. */
  profileImg: string;
  /** Gallery — the re-hosted image URLs, in order. Empty when none hosted. */
  salonImages: string[];
}

function isCloudinary(url: string): boolean {
  return url.includes("res.cloudinary.com");
}

/**
 * Forces a Cloudinary/Planity delivery URL to serve JPEG. Planity uses
 * `.../image/upload/q_auto,f_auto/<id>`, and `f_auto` yields WebP to most
 * clients; swapping it for `f_jpg` guarantees a broadly-renderable JPEG.
 */
function forceJpg(url: string): string {
  return url.replace(/\/image\/upload\/([^/]*)\//, (_m, transforms: string) => {
    const kept = transforms.split(",").filter((t) => t && !/^f_/.test(t));
    kept.push("f_jpg");
    return `/image/upload/${kept.join(",")}/`;
  });
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 1000 ? buf : null;
  } catch {
    return null;
  }
}

/** Downloads one image (forcing JPEG for Cloudinary) and uploads it public. Returns its URL or null. */
async function hostOne(url: string, storagePath: string): Promise<string | null> {
  const buf = await fetchImage(isCloudinary(url) ? forceJpg(url) : url);
  if (!buf) return null;
  const file = getMediaBucket().file(storagePath);
  await file.save(buf, {
    resumable: false,
    contentType: "image/jpeg",
    metadata: { metadata: { originalUrl: url, uploadedBy: "crm-onboarding" } },
  });
  await file.makePublic();
  return `https://storage.googleapis.com/${MEDIA_BUCKET}/${storagePath}`;
}

/**
 * Re-hosts up to [MAX_IMAGES] of `imageUrls` into the EU media bucket under
 * `salon_images/<ownerId>/<i>-<now>.jpg`, plus a dedicated main image under
 * `profile_images/<ownerId>_<now>.jpg`. `now` is injected (epoch ms) so paths
 * are unique per run (busts the CDN's immutable cache) and the function stays
 * deterministic. Never throws — download/upload failures are recorded in
 * `warnings` and simply drop that image.
 */
export async function rehostSalonImages(
  ownerId: string,
  imageUrls: readonly string[],
  now: number,
  warnings: string[],
): Promise<RehostedImages> {
  const urls = [...new Set(imageUrls.map((u) => u.trim()).filter(Boolean))]
    .filter((u) => /^https?:\/\//.test(u))
    .slice(0, MAX_IMAGES);
  if (urls.length === 0) return { profileImg: "", salonImages: [] };

  const salonImages: string[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const hosted = await hostOne(urls[i], `salon_images/${ownerId}/${i}-${now}.jpg`);
      if (hosted) salonImages.push(hosted);
      else warnings.push(`salon image skipped (download failed): ${urls[i]}`);
    } catch (error) {
      warnings.push(`salon image upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (salonImages.length === 0) return { profileImg: "", salonImages: [] };

  let profileImg = salonImages[0];
  try {
    const main = await hostOne(urls[0], `profile_images/${ownerId}_${now}.jpg`);
    if (main) profileImg = main;
  } catch (error) {
    warnings.push(`profile image upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { profileImg, salonImages };
}
