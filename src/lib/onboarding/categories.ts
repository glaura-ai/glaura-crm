/**
 * Glaura's 7 fixed top-level service categories.
 *
 * Haiku classifies each scraped service into one of these (by NAME, during
 * extraction); we map the name → the Firestore `category_id` here. Services
 * whose category can't be resolved fall back to the app's existing
 * "uncategorized" bucket (`DEFAULT_CATEGORY_ID`).
 *
 * IDs + mapping guidance come from
 * onboarding/.claude/commands/onboard-salon.md (§"Glaura Category IDs" /
 * §"Category Mapping Strategy").
 */

export const GLAURA_CATEGORY_NAMES = [
  "Beauté visage",
  "Epilation",
  "Bien Etre",
  "Nails",
  "Barber",
  "Coiffure",
  "Makeup",
] as const;

export type GlauraCategoryName = (typeof GLAURA_CATEGORY_NAMES)[number];

export const GLAURA_CATEGORIES: Record<GlauraCategoryName, string> = {
  "Beauté visage": "qlwRNcbICdWVZd0CfJ7z",
  Epilation: "pCMUpz8GoD4md1Rqt2cs",
  "Bien Etre": "SceVTrEpBGjSrHO7pwFS",
  Nails: "vZQNDw2KCuEUSyXTTZMf",
  Barber: "W3em4NFLX2aRAu1BFNNN",
  Coiffure: "ixgMn0e5RlzAztxVhfgm",
  Makeup: "XGA7rpOhgHFMr3W3sCnU",
};

/**
 * The app's existing "uncategorized/default" category bucket — the same one
 * `serviceUploadHelpers.js` falls back to when no valid category_id is supplied.
 */
export const DEFAULT_CATEGORY_ID = "pzuJmZnZb5ooR73NZ4OH";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const NORMALIZED_LOOKUP: Record<string, string> = Object.fromEntries(
  (Object.keys(GLAURA_CATEGORIES) as GlauraCategoryName[]).map((name) => [normalize(name), GLAURA_CATEGORIES[name]]),
);

/**
 * Maps a Glaura category NAME (as classified by Haiku) to its Firestore
 * `category_id`, tolerating case/accent differences. Returns
 * `DEFAULT_CATEGORY_ID` when the name doesn't match one of the 7 categories.
 */
export function categoryIdForName(name: string | null | undefined): string {
  if (!name) return DEFAULT_CATEGORY_ID;
  return NORMALIZED_LOOKUP[normalize(name)] ?? DEFAULT_CATEGORY_ID;
}
