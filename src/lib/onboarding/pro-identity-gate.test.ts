import { describe, expect, it, vi } from "vitest";
import { evaluateProSalonIdentity } from "./pro-identity";
import { applyBookingClaim } from "./pro-identity-gate";

const verified = () => evaluateProSalonIdentity({
  bookingSalonName: "Studio Camille",
  bookingUrl: "https://www.planity.com/studio-camille",
  instagramUsername: "",
}, { unverifiedChannel: true });

describe("applyBookingClaim", () => {
  it("skips the claim for laura_demo and stays verified without review", async () => {
    const claim = vi.fn().mockResolvedValue({ claimed: false });
    const result = await applyBookingClaim(verified(), { identityChannel: "laura_demo", bypass: false, claim });
    expect(claim).not.toHaveBeenCalled();
    expect(result.status).toBe("verified");
    expect(result.signals).toContain("sms_channel");
  });

  it("still claims and holds on conflict for the sms channel", async () => {
    const claim = vi.fn().mockResolvedValue({ claimed: false });
    const result = await applyBookingClaim(verified(), { identityChannel: "sms", bypass: false, claim });
    expect(claim).toHaveBeenCalledWith("planity.com/studio-camille", { bypass: false });
    expect(result.status).toBe("review_required");
    expect(result.signals).toContain("booking_claim_conflict");
  });
});
