// Instagram handle normalization.
//
// `Salon.instagram` (and `Prospect.instagram`) stores a *bare* handle: the UI
// renders `@{handle}` and links `instagram.com/{handle}`. Salons type whatever
// they like into the field — `@handle`, a full profile URL, a story link — so
// every write boundary runs input through here first. Storing `@handle` is what
// produced `@@handle` on screen and links to a non-existent profile.

/** Path prefixes that name a piece of content, not a profile. */
const CONTENT_SEGMENTS = new Set(["p", "reel", "reels", "tv", "explore", "s"]);

/** Instagram's own rule: letters, digits, periods and underscores, ≤ 30 chars. */
const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

const INSTAGRAM_HOST = /^(https?:\/\/)?(www\.)?instagram\.com\//;

/**
 * Reduces anything a salon might supply to a bare, lowercased handle.
 *
 * Returns null when the input cannot be a handle (free text, another network's
 * URL, a post permalink) — a dead `@link` in the CRM is worse than an empty
 * field, and the raw text stays in the lead notes either way.
 */
export function normalizeInstagramHandle(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (!trimmed) return null;

  // Spreadsheet exports escape a leading @ as '@ — drop the escape with it.
  const path = trimmed.replace(/^['"`‘’“”]*@+/, "").replace(INSTAGRAM_HOST, "");
  // Still a URL after dropping our own host → it points somewhere else.
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(path)) return null;

  const [first, second] = path.split(/[/?#]/).filter(Boolean);
  if (!first) return null;
  // instagram.com/stories/<handle>/<id> still names the salon; a post or reel
  // permalink does not.
  const candidate = first === "stories" ? second : CONTENT_SEGMENTS.has(first) ? undefined : first;

  const handle = candidate?.replace(/^@+/, "") ?? "";
  return HANDLE_PATTERN.test(handle) ? handle : null;
}
