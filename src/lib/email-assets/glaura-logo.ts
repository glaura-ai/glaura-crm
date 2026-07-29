/**
 * The Glaura logo, inlined as base64 so an email can carry it as a CID part.
 *
 * Emails used to point at https://glaura.ai/images/images/LOGO-glaura-horizontal-couleur.png.
 * That URL is healthy, but a remote <img> is a fetch the client may simply
 * refuse — which is how salons ended up looking at a broken-image icon where
 * the logo should be. An inline part is not a remote fetch, so it renders even
 * when a client blocks external images.
 *
 * Kept as a string rather than a .png read from disk: this module is imported
 * both by the bundled Next server and by the tsx workers, and a base64 constant
 * resolves identically in both instead of depending on a runtime file path.
 *
 * Source: Goglow-website/public/images/images/LOGO-glaura-horizontal-couleur.png
 * (2895x1557), resized to 240x129 and palette-quantised — 5.5 KB.
 */
export const GLAURA_LOGO_CID = "glaura-logo";
export const GLAURA_LOGO_FILENAME = "glaura-logo.png";
export const GLAURA_LOGO_WIDTH = 240;
export const GLAURA_LOGO_HEIGHT = 129;

const BASE64_CHUNKS = [
  "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",
];

export const GLAURA_LOGO_PNG_BASE64 = BASE64_CHUNKS.join("");
