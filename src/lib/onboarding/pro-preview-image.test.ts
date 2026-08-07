import { describe, expect, it } from "vitest";
import {
  privateMediaObjectPath,
  toInlineHeroDataUri,
} from "./pro-preview-image";

describe("pro preview email hero image", () => {
  it("recognizes only objects in the private Glaura EU media bucket", () => {
    expect(privateMediaObjectPath(
      "https://storage.googleapis.com/glaura-user-media-eu/profile_images/salon.jpg",
    )).toBe("profile_images/salon.jpg");
    expect(privateMediaObjectPath(
      "https://storage.googleapis.com/another-bucket/profile_images/salon.jpg",
    )).toBeNull();
    expect(privateMediaObjectPath("https://example.com/glaura-user-media-eu/salon.jpg")).toBeNull();
  });

  it("builds a bounded image data URI for the existing CID inliner", () => {
    expect(toInlineHeroDataUri(Buffer.from("jpeg"), "image/jpeg"))
      .toBe("data:image/jpeg;base64,anBlZw==");
    expect(toInlineHeroDataUri(Buffer.from("html"), "text/html")).toBeNull();
    expect(toInlineHeroDataUri(Buffer.alloc(3 * 1024 * 1024 + 1), "image/jpeg")).toBeNull();
  });
});
