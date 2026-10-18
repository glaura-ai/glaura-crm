import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn().mockResolvedValue(undefined);
const doc = vi.fn(() => ({ set }));
vi.mock("@/lib/firebase-admin", () => ({ getDb: () => ({ collection: () => ({ doc }) }) }));

import { optOutOfDigest } from "./opt-out";

describe("optOutOfDigest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes the opt-out for a real salon", async () => {
    await optOutOfDigest("uid_1");
    expect(doc).toHaveBeenCalledWith("uid_1");
    expect(set).toHaveBeenCalledWith(
      { featureAnnouncements: expect.objectContaining({ emailOptOut: true }) },
      { merge: true },
    );
  });

  it("is a no-op for the test-sample sentinel", async () => {
    await optOutOfDigest("test-sample");
    expect(doc).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
