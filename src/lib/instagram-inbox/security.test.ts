import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature, instagramReplyAllowed } from "./security";
describe("Meta webhook and reply security", () => {
  const body = '{"object":"instagram"}';
  const signed = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  it("accepts only an authentic signature over the exact payload", () => {
    expect(verifyMetaSignature(body, signed, "secret")).toBe(true);
    expect(verifyMetaSignature(`${body} `, signed, "secret")).toBe(false);
    expect(verifyMetaSignature(body, signed, undefined)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=broken", "secret")).toBe(false);
    expect(verifyMetaSignature(body, null, "secret")).toBe(false);
  });
  it("enforces the reply window at its exact boundary", () => {
    const now = new Date("2026-11-08T18:00:00Z");
    expect(instagramReplyAllowed(new Date("2026-11-07T18:00:01Z"), now)).toBe(true);
    expect(instagramReplyAllowed(new Date("2026-11-07T18:00:00Z"), now)).toBe(false);
    expect(instagramReplyAllowed(new Date("2026-11-09T18:00:00Z"), now)).toBe(false);
    expect(instagramReplyAllowed(null, now)).toBe(false);
  });
});
