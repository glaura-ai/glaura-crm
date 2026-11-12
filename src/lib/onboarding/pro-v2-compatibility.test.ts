import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prisma, register, profile, profileSet, activationSet, activation } = vi.hoisted(() => ({
  prisma: { salon: { findFirst: vi.fn(), create: vi.fn() }, activity: { create: vi.fn() }, onboardingJob: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() } },
  activation: {} as Record<string, unknown>, register: vi.fn(), profile: { proPlanCode: "solo_v2" } as Record<string, unknown>, profileSet: vi.fn(), activationSet: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/onboarding/signup-started", () => ({ registerSignupStarted: register }));
vi.mock("@/lib/onboarding/self-serve-salon", () => ({ detectBookingTool: () => ({ bookingTool: "PLANITY", sourceType: "planity" }), reserveSalonSlug: async () => "studio" }));
vi.mock("@/lib/firebase-admin", () => ({ getDb: () => ({ collection: (name: string) => ({ doc: () => name === "userProfile" ? { get: async () => ({ exists: true, data: () => profile, get: (key: string) => key === "companyUserName" ? "studio" : profile[key] }), set: profileSet } : { get: async () => ({ exists: true, data: () => activation }), set: activationSet } }) }), getAuth: vi.fn(), getMediaBucket: vi.fn() }));
import { POST as activate } from "@/app/api/self-serve/activate/route";
import { POST as onboard } from "@/app/api/self-serve/onboard/route";
import { POST as signupStarted } from "@/app/api/self-serve/signup-started/route";
import { proPreviewJobContract } from "./pro-plan";
import { subscriptionMatchesActivation } from "./pro-preview";
import { prepareAndNotifyProPreview } from "./pro-preview-delivery";
import { FieldValue } from "firebase-admin/firestore";

const body = { targetUid: "uid", email: "a@studio.fr", salonName: "Studio", bookingUrl: "https://www.planity.com/studio", activationPreview: true };
const request = (payload: unknown) => new NextRequest("https://crm.glaura.ai/api/self-serve/onboard", { method: "POST", headers: { authorization: "Bearer test-secret", "content-type": "application/json" }, body: JSON.stringify(payload) });
beforeEach(() => {
  vi.clearAllMocks(); Object.keys(activation).forEach(key => delete activation[key]); vi.stubEnv("SELF_SERVE_ONBOARD_SECRET", "test-secret"); vi.stubEnv("PRO_PREVIEW_TOKEN_SECRET", "a".repeat(32));
  prisma.salon.findFirst.mockResolvedValue(null); prisma.salon.create.mockResolvedValue({ id: "salon" }); prisma.onboardingJob.findMany.mockResolvedValue([]); prisma.onboardingJob.findFirst.mockResolvedValue(null); prisma.onboardingJob.create.mockResolvedValue({ id: "job", status: "QUEUED" }); register.mockResolvedValue({ created: true });
});
afterEach(() => vi.unstubAllEnvs());
describe("CRM V2 compatibility", () => {
  it.each(["essentiel_v2", "solo_v2", "salon_v2"])("passes %s and trial zero into the queued job unchanged", async (planCode) => {
    const response = await onboard(request({ ...body, planCode, trialPeriodDays: 0 }));
    expect(response.status).toBe(202);
    expect(prisma.onboardingJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ config: expect.objectContaining({ planCode, trialPeriodDays: 0, enable: false }) }) }));
    expect((await signupStarted(request({ ...body, planCode }))).status).toBe(201);
    expect(register).toHaveBeenCalledWith(prisma, expect.objectContaining({ planCode }));
  });
  it("rejects yearly or manufactured V2 trial while retaining old payloads", async () => {
    expect((await onboard(request({ ...body, activationPreview: false, planCode: "salon_v2", trialPeriodDays: 0 }))).status).toBe(400);
    expect((await onboard(request({ ...body, planCode: "salon_v2_yearly", trialPeriodDays: 0 }))).status).toBe(400);
    expect((await onboard(request({ ...body, planCode: "solo_v2", trialPeriodDays: 14 }))).status).toBe(400);
    expect((await onboard(request({ ...body, planCode: "basic", trialPeriodDays: 7 }))).status).toBe(202);
    expect((await onboard(request({ ...body, planCode: "reservation", trialPeriodDays: 14 }))).status).toBe(202);
  });
  it("recognizes V2 activation records but keeps payment required and rejects yearly", async () => {
    Object.assign(activation, { uid: "uid", status: "preview_ready", expiresAtMs: Date.now() + 60000, email: "a@studio.fr", salonId: "salon" });
    for (const planCode of ["essentiel_v2", "solo_v2", "salon_v2"] as const) {
      activation.planCode = planCode;
      const response = await activate(request({ uid: "uid", tokenHash: "a".repeat(64), isStripeLive: true }));
      expect(response.status).toBe(402);
      expect(await response.json()).toMatchObject({ error: "payment_required" });
    }
    activation.planCode = "salon_v2_yearly";
    expect((await activate(request({ uid: "uid", tokenHash: "a".repeat(64) }))).status).toBe(409);
    expect(profileSet).not.toHaveBeenCalled();
  });
  it("serializes exact worker identities and keeps missing legacy defaults", () => {
    for (const planCode of ["essentiel_v2", "solo_v2", "salon_v2"] as const) {
      expect(proPreviewJobContract({ planCode, trialPeriodDays: 0 })).toEqual({ planCode, trialPeriodDays: 0 });
      expect(subscriptionMatchesActivation({ stripeSubscriptionId: "sub", stripeSubscriptionStatus: "active", stripeSubscriptionIsLive: true, stripeSubscriptionPlanCode: planCode }, planCode)).toBe(true);
      expect(subscriptionMatchesActivation({ stripeSubscriptionId: "sub", stripeSubscriptionStatus: "active", stripeSubscriptionIsLive: true, stripeSubscriptionPlanCode: "reservation" }, planCode)).toBe(false);
    }
    expect(proPreviewJobContract({})).toEqual({ planCode: "reservation", trialPeriodDays: 14 });
    expect(proPreviewJobContract({ planCode: "basic", trialPeriodDays: 7 })).toEqual({ planCode: "basic", trialPeriodDays: 7 });
    expect(() => proPreviewJobContract({ planCode: "salon_v2_yearly" })).toThrow("Unknown Pro onboarding plan");
    expect(() => proPreviewJobContract({ planCode: "bogus" })).toThrow("Unknown Pro onboarding plan");
  });
  it("writes latest V2 profile choice to both activation and checkout offer without trial reset", async () => {
    profile.proPlanCode = "salon_v2";
    const emailJob = { findFirst: vi.fn().mockResolvedValue({ id: "email" }) };
    await prepareAndNotifyProPreview({ prisma: { emailJob } as never, jobId: "job", salonId: "salon", uid: "uid", email: "", phone: "", salonName: "Studio", serviceCount: 2, planCode: "solo_v2", trialPeriodDays: 0 });
    expect(activationSet).toHaveBeenCalledWith(expect.objectContaining({ planCode: "salon_v2", trialPeriodDays: 0 }), { merge: true });
    expect(profileSet).toHaveBeenCalledWith(expect.objectContaining({ enable: false, billingCheckoutOffer: expect.objectContaining({ planCode: "salon_v2", trialPeriodDays: 0 }) }), { merge: true });
  });
});

it.each(["essentiel_v2_commitment", "solo_v2_commitment", "salon_v2_commitment"])("preserves %s in API jobs and worker contract", async (planCode) => {
  expect((await onboard(request({ ...body, planCode, trialPeriodDays: 0 }))).status).toBe(202);
  expect(prisma.onboardingJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ config: expect.objectContaining({ planCode, trialPeriodDays: 0 }) }) }));
  expect(proPreviewJobContract({ planCode, trialPeriodDays: 0 })).toEqual({ planCode, trialPeriodDays: 0 });
});

it("uses the latest commitment choice in previews without granting ordinary monthly activation", async () => {
  profile.proPlanCode = "salon_v2_commitment";
  await prepareAndNotifyProPreview({ prisma: { emailJob: { findFirst: vi.fn().mockResolvedValue({ id: "email" }) } } as never, jobId: "job", salonId: "salon", uid: "uid", email: "", phone: "", salonName: "Studio", serviceCount: 2, planCode: "solo_v2_commitment", trialPeriodDays: 0 });
  expect(activationSet).toHaveBeenCalledWith(expect.objectContaining({ planCode: "salon_v2_commitment", trialPeriodDays: 0 }), { merge: true });
  expect(profileSet).toHaveBeenCalledWith(expect.objectContaining({ billingCheckoutOffer: expect.objectContaining({ planCode: "salon_v2_commitment", trialPeriodDays: 0 }) }), { merge: true });
  expect(subscriptionMatchesActivation({ stripeSubscriptionId: "sub", stripeSubscriptionStatus: "active", stripeSubscriptionIsLive: true, stripeSubscriptionPlanCode: "salon_v2" }, "salon_v2_commitment")).toBe(false);
});

describe("CRM demo flow", () => {
  const demoBody = { ...body, identityChannel: "sms", onboardingFlow: "demo" };
  const calendar = "https://calendar.google.com/calendar/appointments/schedules/AcZssZ1ipzl7I8eSuqajWYTfp1Ro0TQljDjamtIwGbVPRWEedpKeRsV8tAnjRnqGJC5lMw5xbbwY2MxV";
  const emailCreate = vi.fn();
  const demoPrisma = () => ({ emailJob: { findFirst: vi.fn().mockResolvedValue(null), create: emailCreate }, emailTemplate: { findFirst: vi.fn().mockResolvedValue(null) } });
  const demoInput = { jobId: "job", salonId: "salon", uid: "uid", email: "a@studio.fr", phone: "+33612345678", salonName: "Studio", serviceCount: 2, onboardingFlow: "demo" as const };

  it("accepts a demo signup without plan or trial and stores the flag in the job", async () => {
    expect((await onboard(request(demoBody))).status).toBe(202);
    const data = prisma.onboardingJob.create.mock.calls[0][0].data;
    expect(data.config).toMatchObject({ onboardingFlow: "demo", activationPreview: true, enable: false });
    expect(data.config.planCode).toBeUndefined();
  });
  it("still requires a plan outside the demo flow and keeps demo preview-only", async () => {
    expect((await onboard(request({ ...body, identityChannel: "sms" }))).status).toBe(400);
    expect((await onboard(request({ ...demoBody, activationPreview: false }))).status).toBe(400);
    expect((await onboard(request({ ...demoBody, targetUid: undefined }))).status).toBe(400);
  });
  it("writes demo_pending with no plan and never a checkout offer", async () => {
    profile.proPlanCode = "solo_v2";
    await prepareAndNotifyProPreview({ prisma: demoPrisma() as never, ...demoInput });
    expect(activationSet).toHaveBeenCalledWith(expect.objectContaining({ planCode: null, trialPeriodDays: null, status: "demo_pending" }), { merge: true });
    const [profileData] = profileSet.mock.calls[0];
    expect(profileData).toMatchObject({ enable: false, isActive: false, available: false, proOnboardingStatus: "demo_pending" });
    expect(profileData.billingCheckoutOffer).toEqual(FieldValue.delete());
  });
  it("queues the demo email with the calendar CTA and no subscription wording", async () => {
    vi.stubEnv("GLAURA_PRO_SALES_CALENDAR_URL", "");
    await prepareAndNotifyProPreview({ prisma: demoPrisma() as never, ...demoInput });
    const data = emailCreate.mock.calls[0][0].data;
    expect(data.subject).toBe("Studio — votre page Glaura est prête");
    for (const part of [data.body, data.bodyText]) {
      expect(part).toContain(calendar);
      expect(part).toContain("https://glaura.ai/pro/preview/");
      expect(part).not.toMatch(/abonnement|essai|engagement|€\s*\/|par mois/i);
    }
    expect(data.body).toContain("Réserver ma démo");
    expect(data.body).toContain("Voir ma page");
  });
  it("sends a one-segment demo SMS with only the preview link", async () => {
    vi.stubEnv("GLAURA_SMS_SEND_URL", "https://sms.test/send");
    vi.stubEnv("GLAURA_PRO_SALES_CALENDAR_URL", "https://cal.test/demo");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await prepareAndNotifyProPreview({ prisma: demoPrisma() as never, ...demoInput });
    } finally {
      vi.unstubAllGlobals();
    }
    const sms = JSON.parse(fetchMock.mock.calls[0][1].body).Body as string;
    expect(sms).toMatch(/^Votre page Glaura pour Studio vous attend : https:\/\/glaura\.ai\/pro\/preview\/\S+$/);
  });
});
