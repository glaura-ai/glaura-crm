/**
 * PURE analysis of the `<img>` sources inside an HTML email body.
 *
 * An email is not a web page: a relative path has no base URL to resolve
 * against, a `cid:` reference is broken unless the message actually carries that
 * part, and a remote `https://` image is a fetch the client may refuse — which
 * is exactly how the onboarding logo ended up rendering as a broken icon.
 *
 * The send path (src/lib/email-inline-images.ts) turns what it can into inline
 * parts; this module is the shared vocabulary for what "can" means, so the
 * editor warns about the same sources the sender would have to give up on.
 *
 * No Node APIs — the /modeles editor runs this in the browser.
 */

import { GLAURA_LOGO_CID } from "@/lib/email-assets/glaura-logo";

/**
 * Hosts whose images the sender will download and inline.
 *
 * An allowlist rather than "any https URL": the fetch happens server-side from
 * a body an operator pasted, so an open-ended list would let a paste aim our
 * server at an arbitrary host. These are the buckets and domains Glaura already
 * publishes images on (see src/lib/onboarding/images.ts for the media bucket).
 */
export const EMAIL_IMAGE_HOSTS: readonly string[] = [
  "glaura.ai",
  "www.glaura.ai",
  "images.glaura.ai",
  "storage.googleapis.com",
  "firebasestorage.googleapis.com",
];

/**
 * What the uploader accepts, and the extension each type gets. Lives in this
 * (browser-safe) module rather than next to the upload code so the editor can
 * render the file picker without pulling firebase-admin into the client bundle.
 */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const ACCEPTED_IMAGE_TYPES = Object.keys(IMAGE_EXTENSIONS);

/** Comfortably above a retina logo/banner, well under the inline-part cap. */
export const MAX_EMAIL_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageSourceKind =
  /** `cid:glaura-logo` — the part every message carries. */
  | "inline-logo"
  /** `data:image/…;base64,…` — decoded and attached at send time. */
  | "data"
  /** An allowlisted https URL — downloaded and attached at send time. */
  | "hosted"
  /** https, but somewhere we will not fetch from: sent as a remote image. */
  | "foreign-host"
  /** http:// — never fetched, and flagged by clients. */
  | "insecure"
  /** Some other `cid:` — nothing attaches it, so it is always broken. */
  | "dangling-cid"
  /** A relative or malformed path — meaningless in an email. */
  | "relative";

/** Every distinct `<img src>` in the body, in document order. */
export function extractImageSources(html: string): string[] {
  const pattern = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const found = new Set<string>();
  for (const match of html.matchAll(pattern)) {
    const src = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (src) found.add(src);
  }
  return [...found];
}

export function classifyImageSource(src: string): ImageSourceKind {
  const value = src.trim();
  if (value.toLowerCase().startsWith("cid:")) {
    return value.slice(4) === GLAURA_LOGO_CID ? "inline-logo" : "dangling-cid";
  }
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return "data";
  if (/^http:\/\//i.test(value)) return "insecure";
  if (/^https:\/\//i.test(value)) {
    try {
      return EMAIL_IMAGE_HOSTS.includes(new URL(value).hostname.toLowerCase()) ? "hosted" : "foreign-host";
    } catch {
      return "relative";
    }
  }
  return "relative";
}

/** True for sources the sender can turn into an inline part. */
export function isInlinable(kind: ImageSourceKind): boolean {
  return kind === "data" || kind === "hosted";
}

export type ImageWarning = { src: string; message: string };

/**
 * What an author needs to hear before saving. Sources that will render — the
 * logo, data URIs, allowlisted hosts — are silent; everything else explains
 * itself in the terms a template author can act on.
 */
export function imageWarnings(html: string): ImageWarning[] {
  const warnings: ImageWarning[] = [];
  for (const src of extractImageSources(html)) {
    switch (classifyImageSource(src)) {
      case "dangling-cid":
        warnings.push({ src, message: "cid inconnu — seul cid:glaura-logo est fourni par l'envoi" });
        break;
      case "relative":
        warnings.push({ src, message: "chemin relatif — une image d'email doit avoir une URL absolue" });
        break;
      case "insecure":
        warnings.push({ src, message: "URL en http — héberge l'image (bouton ci-dessous) pour qu'elle soit intégrée" });
        break;
      case "foreign-host":
        warnings.push({ src, message: "hôte externe — l'image ne sera pas intégrée et dépendra du client mail" });
        break;
      default:
        break;
    }
  }
  return warnings;
}
