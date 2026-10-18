import { describe, expect, it, vi } from "vitest";
import { runDigest, type DigestDeps } from "./run";

const recipients = Array.from({ length: 45 }, (_, i) => ({
  providerId: `p${i}`,
  email: `s${i}@x.fr`,
  salonName: `Salon ${i}`,
}));

function deps(over: Partial<DigestDeps> = {}): DigestDeps {
  return {
    edition: "2026-11",
    recipients,
    sentProviderIds: new Set<string>(),
    send: vi.fn().mockResolvedValue(undefined),
    record: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined),
    batchSize: 20,
    delayMs: 1500,
    ...over,
  };
}

describe("runDigest", () => {
  it("dry-run sends and records nothing", async () => {
    const d = deps();
    const r = await runDigest(d, { mode: "dry-run" });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
    expect(r.total).toBe(45);
    expect(r.preview).toHaveLength(20);
  });

  it("all: sends in batches of 20 with a pause between batches and records each", async () => {
    const d = deps();
    const r = await runDigest(d, { mode: "all" });
    expect(d.send).toHaveBeenCalledTimes(45);
    expect(d.record).toHaveBeenCalledTimes(45);
    expect(d.sleep).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledWith(1500);
    expect(r.sent).toBe(45);
  });

  it("all: skips salons already sent for the edition", async () => {
    const d = deps({ sentProviderIds: new Set(["p0", "p1"]) });
    const r = await runDigest(d, { mode: "all" });
    expect(d.send).toHaveBeenCalledTimes(43);
    expect(r.skipped).toBe(2);
  });

  it("all: records failures and continues", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("smtp down")).mockResolvedValue(undefined);
    const d = deps({ send, recipients: recipients.slice(0, 3) });
    const r = await runDigest(d, { mode: "all" });
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(2);
    expect(d.record).toHaveBeenCalledWith(expect.objectContaining({ providerId: "p0", error: "smtp down" }));
  });

  it("test: sends one sample and records nothing", async () => {
    const d = deps();
    const r = await runDigest(d, { mode: "test", to: "henry@x.fr" });
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.send).toHaveBeenCalledWith(
      expect.objectContaining({ email: "henry@x.fr", sample: true }),
    );
    expect(d.record).not.toHaveBeenCalled();
    expect(r.sent).toBe(1);
  });
});
