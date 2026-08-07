const MAX_INLINE_HERO_BYTES = 3 * 1024 * 1024;
const INLINE_HERO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function privateMediaObjectPath(src?: string | null): string | null {
  try {
    const url = new URL(src?.trim() || "");
    const prefix = "/glaura-user-media-eu/";
    if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com" || !url.pathname.startsWith(prefix)) {
      return null;
    }
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    return path && !path.split("/").includes("..") ? path : null;
  } catch {
    return null;
  }
}

export function toInlineHeroDataUri(content: Buffer, contentType: string): string | null {
  const normalizedType = contentType.split(";")[0].trim().toLowerCase();
  if (!INLINE_HERO_TYPES.has(normalizedType) || !content.length || content.length > MAX_INLINE_HERO_BYTES) return null;
  return `data:${normalizedType};base64,${content.toString("base64")}`;
}

export function isInlineHeroDataUri(value: string): boolean {
  if (value.length > Math.ceil(MAX_INLINE_HERO_BYTES * 4 / 3) + 64) return false;
  return /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(value);
}
