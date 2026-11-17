import { describe, expect, it, vi } from "vitest";
import { checkIgGraphToken, createTokenWatch } from "./token-watch";

const config = { token: "t", userId: "1" };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("checkIgGraphToken", () => {
  it("is ok when the Graph API answers with the user id", async () => {
    const fetcher = vi.fn(async () => json({ id: "1" }));
    await expect(checkIgGraphToken(config, fetcher)).resolves.toEqual({ ok: true });
  });

  it("reports the Graph error", async () => {
    const fetcher = vi.fn(async () => json({ error: { message: "Session invalidated", code: 190 } }));
    await expect(checkIgGraphToken(config, fetcher)).resolves.toEqual({ ok: false, reason: "Session invalidated (code 190)" });
  });

  it("reports a missing config", async () => {
    await expect(checkIgGraphToken(null, vi.fn())).resolves.toEqual({ ok: false, reason: "IG_GRAPH_TOKEN / IG_GRAPH_USER_ID non définis" });
  });
});

describe("createTokenWatch", () => {
  it("checks at most once per interval and alerts only when broken", async () => {
    let now = 0;
    const check = vi.fn(async () => ({ ok: false as const, reason: "dead" }));
    const notify = vi.fn(async () => {});
    const tick = createTokenWatch({ check, notify, intervalMs: 1000, now: () => now });

    await tick();
    await tick();
    expect(check).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("dead");

    now = 1000;
    check.mockResolvedValueOnce({ ok: true } as never);
    await tick();
    expect(check).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("never throws when the check or the alert fails", async () => {
    const tick = createTokenWatch({
      check: async () => ({ ok: false, reason: "dead" }),
      notify: async () => { throw new Error("smtp down"); },
      intervalMs: 1000,
      now: () => 0,
    });
    await expect(tick()).resolves.toBeUndefined();
  });
});
