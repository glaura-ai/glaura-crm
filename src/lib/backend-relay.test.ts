import { afterEach, describe, expect, it, vi } from "vitest";
import { smsRelayBody, smsRelayHeaders, smsRelayUrl } from "./backend-relay";
import { sendTrialEndingSms } from "./transactional/trial-ending";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("smsRelayHeaders", () => {
  it("adds the SMS secret when configured", () => {
    vi.stubEnv("GOGLOW_BACKEND_SMS_SECRET", "s");
    expect(smsRelayHeaders()).toEqual({ "content-type": "application/json", "x-glaura-sms-secret": "s" });
  });
  it("omits the header without a secret", () => {
    vi.stubEnv("GOGLOW_BACKEND_SMS_SECRET", "");
    expect(smsRelayHeaders()).toEqual({ "content-type": "application/json" });
  });
});

describe("smsRelayUrl", () => {
  it("defaults to the gateway compat endpoint", () => {
    vi.stubEnv("GLAURA_SMS_SEND_URL", "");
    vi.stubEnv("GLAURA_GATEWAY_URL", "");
    expect(smsRelayUrl()).toBe("https://api.glaura.ai/notifications/send-sms");
  });
  it("honours the gateway base and the explicit override", () => {
    vi.stubEnv("GLAURA_SMS_SEND_URL", "");
    vi.stubEnv("GLAURA_GATEWAY_URL", "https://gw.test/");
    expect(smsRelayUrl()).toBe("https://gw.test/notifications/send-sms");
    vi.stubEnv("GLAURA_SMS_SEND_URL", "https://x.test/s");
    expect(smsRelayUrl()).toBe("https://x.test/s");
  });
});

describe("smsRelayBody", () => {
  it("adds source and optional idempotencyKey", () => {
    expect(JSON.parse(smsRelayBody({ to: "06", body: "hi", source: "crm_x", idempotencyKey: "k" })))
      .toEqual({ To: "06", Body: "hi", source: "crm_x", idempotencyKey: "k" });
    expect(JSON.parse(smsRelayBody({ to: "06", body: "hi", source: "crm_x" }))).not.toHaveProperty("idempotencyKey");
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
    }, "evt_1");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      source: "crm_trial_ending",
      idempotencyKey: "evt_1",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-glaura-sms-secret": "s" });
  });
});
