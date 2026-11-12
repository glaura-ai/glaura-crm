import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  send: vi.fn(),
  findJob: vi.fn(),
  findSalon: vi.fn(),
  update: vi.fn(),
  activity: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    onboardingJob: { findFirst: m.findJob },
    salon: { findFirst: m.findSalon, update: m.update },
    activity: { create: m.activity },
  },
}));
vi.mock("@/lib/onboarding/magic-link", () => ({ maybeSendMagicLinkEmail: m.send }));
vi.mock("@/lib/firebase-admin", () => ({ getAuth: () => ({ getUser: m.getUser }) }));

import { POST } from "./route";

const SECRET = "s3cret";
function req(body: unknown, auth: string | null = `Bearer ${SECRET}`) {
  return new Request("http://x/api/transactional/pro-activation-ready", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.TRANSACTIONAL_EMAIL_SECRET = SECRET;
  m.send.mockResolvedValue({ sent: true });
  m.findJob.mockResolvedValue({ salonId: "salon1" });
  m.findSalon.mockResolvedValue({ id: "salon1", name: "Studio", contactEmail: null, signedAt: null, accountStatusLabel: "demo_booked" });
  m.update.mockResolvedValue({});
  m.activity.mockResolvedValue({});
});

describe("POST /api/transactional/pro-activation-ready", () => {
  it("503 when the secret is unset", async () => {
    delete process.env.TRANSACTIONAL_EMAIL_SECRET;
    expect((await POST(req({ uid: "u1" }))).status).toBe(503);
  });

  it("401 on a wrong or missing secret", async () => {
    expect((await POST(req({ uid: "u1" }, "Bearer nope"))).status).toBe(401);
    expect((await POST(req({ uid: "u1" }, null))).status).toBe(401);
  });

  it("400 on an invalid body", async () => {
    expect((await POST(req({}))).status).toBe(400);
  });

  it("sends the email and marks the salon signed", async () => {
    const res = await POST(req({ uid: "u1", email: "a@b.fr", salonName: "Studio", isStripeLive: false }));
    expect(await res.json()).toEqual({ ok: true, emailSent: true, crmUpdated: true });
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({
      uid: "u1", email: "a@b.fr", salonName: "Studio", emailKind: "pro_activation",
    }));
    const data = m.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "SIGNE", accountStatusLabel: "active" });
    expect(data.signedAt).toBeInstanceOf(Date);
    expect(data.activatedAt).toBeInstanceOf(Date);
    expect(m.activity).toHaveBeenCalled();
  });

  it("keeps an existing signedAt", async () => {
    m.findSalon.mockResolvedValue({ id: "salon1", name: "S", contactEmail: null, signedAt: new Date("2026-01-01"), accountStatusLabel: "self_serve" });
    await POST(req({ uid: "u1", email: "a@b.fr" }));
    expect(m.update.mock.calls[0][0].data.signedAt).toBeUndefined();
  });

  it("emails only when no salon is found", async () => {
    m.findJob.mockResolvedValue(null);
    m.findSalon.mockResolvedValue(null);
    const res = await POST(req({ uid: "u1", email: "a@b.fr" }));
    expect(await res.json()).toEqual({ ok: true, emailSent: true, crmUpdated: false });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("falls back to the Firebase Auth email", async () => {
    m.getUser.mockResolvedValue({ email: "auth@b.fr" });
    await POST(req({ uid: "u1" }));
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ email: "auth@b.fr" }));
  });

  it("502 when the email fails but the CRM is still updated", async () => {
    m.send.mockResolvedValue({ sent: false, error: "smtp down" });
    const res = await POST(req({ uid: "u1", email: "a@b.fr" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, emailSent: false, crmUpdated: true, error: "smtp down" });
    expect(m.update).toHaveBeenCalled();
  });
});
