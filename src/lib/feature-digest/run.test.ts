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
    send: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue(true),
    markSent: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    optedOut: vi.fn().mockResolvedValue(new Set<string>()),
    sleep: vi.fn().mockResolvedValue(undefined),
    batchSize: 20,
    delayMs: 1500,
    ...over,
  };
}

describe("runDigest", () => {
  it("dry-run sends and claims nothing", async () => {
    const d = deps();
    const r = await runDigest(d, { mode: "dry-run" });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.claim).not.toHaveBeenCalled();
    expect(r.total).toBe(45);
    expect(r.preview).toHaveLength(20);
  });

  it("all: batches of 20 with a pause between, claims before send, marks sent", async () => {
    const order: string[] = [];
    const d = deps({
      claim: vi.fn(async () => (order.push("claim"), true)),
      send: vi.fn(async () => void order.push("send")),
      markSent: vi.fn(async () => void order.push("sent")),
    });
    const r = await runDigest(d, { mode: "all" });
    expect(order.slice(0, 3)).toEqual(["claim", "send", "sent"]);
    expect(d.send).toHaveBeenCalledTimes(45);
    expect(d.sleep).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledWith(1500);
    expect(r.sent).toBe(45);
  });

  it("all: skips salons whose claim fails (already sent, in flight, lost race)", async () => {
    const d = deps({ claim: vi.fn(async (r) => r.providerId !== "p0" && r.providerId !== "p1") });
    const r = await runDigest(d, { mode: "all" });
    expect(d.send).toHaveBeenCalledTimes(43);
    expect(r.skipped).toBe(2);
  });

  it("all: re-checks opt-outs for every batch", async () => {
    const optedOut = vi
      .fn()
      .mockResolvedValueOnce(new Set<string>())
      .mockResolvedValueOnce(new Set(["p20"]))
      .mockResolvedValue(new Set<string>());
    const d = deps({ optedOut });
    const r = await runDigest(d, { mode: "all" });
    expect(optedOut).toHaveBeenCalledTimes(3);
    expect(d.send).not.toHaveBeenCalledWith(expect.objectContaining({ providerId: "p20" }));
    expect(r.skipped).toBe(1);
  });

  it("all: a send failure marks the error and continues", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("smtp down")).mockResolvedValue(undefined);
    const d = deps({ send, recipients: recipients.slice(0, 3) });
    const r = await runDigest(d, { mode: "all" });
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(2);
    expect(d.markFailed).toHaveBeenCalledWith(expect.objectContaining({ providerId: "p0" }), "smtp down");
    expect(d.markSent).toHaveBeenCalledTimes(2);
  });

  it("all: a markSent failure is counted, never flagged as a send failure", async () => {
    const d = deps({
      recipients: recipients.slice(0, 2),
      markSent: vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined),
    });
    const r = await runDigest(d, { mode: "all" });
    expect(r.sent).toBe(2);
    expect(r.unrecorded).toBe(1);
    expect(r.failed).toBe(0);
    expect(d.markFailed).not.toHaveBeenCalled();
  });

  it("test: sends one sample with the sentinel id and claims nothing", async () => {
    const d = deps();
    const r = await runDigest(d, { mode: "test", to: "henry@x.fr" });
    expect(d.send).toHaveBeenCalledWith(
      expect.objectContaining({ email: "henry@x.fr", sample: true, providerId: "test-sample" }),
    );
    expect(d.claim).not.toHaveBeenCalled();
    expect(r.sent).toBe(1);
  });
});
