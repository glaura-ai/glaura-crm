import { afterEach, describe, expect, it, vi } from "vitest";
import { smsRelayHeaders } from "./backend-relay";
import { sendTrialEndingSms } from "./transactional/trial-ending";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("smsRelayHeaders", () => {
  it("adds the SMS secret when configured", () => {
    vi.stubEnv("GOGLOW_BACKEND_SMS_SECRET", "s");
    expect(smsRelayHeaders()).toEqual({ "content-type": "application/json", "X-Glaura-SMS-Secret": "s" });
  });
  it("omits the header without a secret", () => {
    vi.stubEnv("GOGLOW_BACKEND_SMS_SECRET", "");
    expect(smsRelayHeaders()).toEqual({ "content-type": "application/json" });
  });
});

describe("sendTrialEndingSms", () => {
  it("sends the relay secret to the backend", async () => {
    vi.stubEnv("GLAURA_SMS_SEND_URL", "https://backend.test/api/send-sms");
    vi.stubEnv("GOGLOW_BACKEND_SMS_SECRET", "s");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendTrialEndingSms("0612345678", {
      salonName: "Studio",
      planName: "Pro",
      trialEndsAt: "2026-08-21T13:53:38.000Z",
      billingUrl: "https://pro.glaura.ai/payments",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-Glaura-SMS-Secret": "s" });
  });
});
