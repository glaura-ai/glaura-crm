import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  seqFind: vi.fn(), seqFindUnique: vi.fn(), seqUpdate: vi.fn(), seqUpdateMany: vi.fn(), seqCreateMany: vi.fn(),
  convFind: vi.fn(), convUpdateMany: vi.fn(), msgFind: vi.fn(), msgUpsert: vi.fn(), taskUpsert: vi.fn(),
  inbox: vi.fn(), meta: vi.fn(), store: vi.fn(), wa: vi.fn(), optOut: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  outreachSequence: { findMany: m.seqFind, findUnique: m.seqFindUnique, update: m.seqUpdate, updateMany: m.seqUpdateMany, createMany: m.seqCreateMany },
  instagramConversation: { findMany: m.convFind, updateMany: m.convUpdateMany },
  instagramMessage: { findMany: m.msgFind, upsert: m.msgUpsert }, salesTask: { upsert: m.taskUpsert },
} }));
vi.mock("@/lib/instagram-inbox/client", () => ({ inboxConfig: m.inbox, metaRequest: m.meta }));
vi.mock("@/lib/instagram-inbox/store", () => ({ storeInstagramMessage: m.store }));
vi.mock("./whatsapp", () => ({ sendOutreachTemplate: m.wa, isWhatsappOptedOut: m.optOut }));
import { processOutreach } from "./engine";

const now = new Date("2026-11-18T09:00:00Z");
const conv = (o = {}) => ({ id: "c1", participantId: "p1", username: "lea", lastInboundAt: now, resolvedAt: null, qualification: "CHAUD", qualificationPending: false, qualifiedMessageId: null, qualifiedMessageHash: null, salon: { id: "s1", name: "Studio Léa", status: "INTERESSE", accountStatusLabel: null, assignedToId: "u1" }, ...o });
const seq = (o = {}) => ({ conversationId: "c1", status: "ACTIVE", step: 0, startedAt: now, lastSentAt: null, phone: null, lastError: null, conversation: conv(), ...o });
const inbound = (text: string, sentAt = now) => ({ id: `i-${text}`, text, sentAt, incoming: true });
const saved = () => m.seqUpdate.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); vi.stubEnv("OUTREACH_ENABLED", "true");
  vi.stubEnv("META_SYSTEM_USER_TOKEN", "t"); vi.stubEnv("WHATSAPP_OUTREACH_PHONE_NUMBER_ID", "1"); vi.stubEnv("OUTREACH_WA_TEMPLATE_1", "tpl1"); vi.stubEnv("OUTREACH_WA_TEMPLATE_2", "tpl2");
  m.seqFind.mockResolvedValue([{ conversationId: "c1" }]); m.seqUpdateMany.mockResolvedValue({ count: 1 });
  m.seqFindUnique.mockResolvedValue(seq()); m.msgFind.mockResolvedValue([inbound("salut")]);
  m.inbox.mockResolvedValue({ accountId: "acc" }); m.meta.mockResolvedValue({ message_id: "mid" }); m.wa.mockResolvedValue("wamid.9"); m.optOut.mockResolvedValue(false);
});

it("does nothing when disabled", async () => {
  vi.stubEnv("OUTREACH_ENABLED", "");
  await processOutreach(now);
  expect(m.seqFind).not.toHaveBeenCalled(); expect(m.convFind).not.toHaveBeenCalled();
});
it("auto-enrols hot/warm conversations without a sequence only when enabled", async () => {
  m.convFind.mockResolvedValue([{ id: "c9" }]); m.seqFind.mockResolvedValue([]);
  await processOutreach(now);
  expect(m.convFind).not.toHaveBeenCalled();
  vi.stubEnv("OUTREACH_AUTO_START", "true");
  await processOutreach(now);
  expect(m.convFind.mock.calls[0][0].where).toMatchObject({ qualification: { in: ["CHAUD", "TIEDE"] }, outreach: { is: null } });
  expect(m.seqCreateMany).toHaveBeenCalledWith({ data: [{ conversationId: "c9", nextRunAt: now }], skipDuplicates: true });
});
it("skips a row another worker already leased", async () => {
  m.seqUpdateMany.mockResolvedValue({ count: 0 });
  await processOutreach(now);
  expect(m.seqFindUnique).not.toHaveBeenCalled();
});
it("step 0 sends the Instagram message, records it and advances", async () => {
  await processOutreach(now);
  expect(m.meta).toHaveBeenCalledWith("acc/messages", expect.objectContaining({ method: "POST" }), expect.anything());
  expect(m.store).toHaveBeenCalledWith("acc", expect.objectContaining({ participantId: "p1", incoming: false }));
  expect(saved()).toMatchObject({ step: 1, lastSentAt: now, leaseAt: null, lastError: null });
});
it("stops on a closed salon without sending", async () => {
  m.seqFindUnique.mockResolvedValue(seq({ conversation: conv({ salon: { id: "s1", name: "x", status: "SIGNE", accountStatusLabel: null, assignedToId: null } }) }));
  await processOutreach(now);
  expect(m.meta).not.toHaveBeenCalled();
  expect(saved()).toMatchObject({ status: "STOPPED", stopReason: "SALON_CLOSED", leaseAt: null });
});
it("seeds the phone from a number the contact already typed", async () => {
  m.msgFind.mockResolvedValue([inbound("mon 06 12 34 56 78")]);
  await processOutreach(now);
  expect(saved()).toMatchObject({ phone: "+33612345678", step: 1 });
});
it("sends WhatsApp template 1, mirrors it in the inbox and moves to step 3", async () => {
  const later = new Date("2026-11-20T09:00:00Z");
  m.seqFindUnique.mockResolvedValue(seq({ step: 2, phone: "+33612345678", lastSentAt: now, conversation: conv({ lastInboundAt: now }) }));
  await processOutreach(later);
  expect(m.wa).toHaveBeenCalledWith({ to: "+33612345678", template: "tpl1", displayName: "Studio Léa" });
  expect(m.msgUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ id: "wa:wamid.9", incoming: false, text: expect.stringContaining("+33612345678") }) }));
  expect(m.convUpdateMany).toHaveBeenCalled();
  expect(saved()).toMatchObject({ step: 3, lastSentAt: later });
});
it("finishes after the last WhatsApp template", async () => {
  m.seqFindUnique.mockResolvedValue(seq({ step: 3, phone: "+33612345678", lastSentAt: now }));
  await processOutreach(new Date("2026-11-23T09:00:00Z"));
  expect(m.wa.mock.calls[0][0].template).toBe("tpl2");
  expect(saved()).toMatchObject({ status: "DONE", step: 4 });
});
it("stops without sending when the number opted out", async () => {
  m.optOut.mockResolvedValue(true);
  m.seqFindUnique.mockResolvedValue(seq({ step: 2, phone: "+33612345678", lastSentAt: now }));
  await processOutreach(new Date("2026-11-20T09:00:00Z"));
  expect(m.wa).not.toHaveBeenCalled();
  expect(saved()).toMatchObject({ status: "STOPPED", stopReason: "WHATSAPP_OPT_OUT" });
});
it("creates a task for the salon owner at step 3 without a phone", async () => {
  m.seqFindUnique.mockResolvedValue(seq({ step: 3, lastSentAt: now }));
  await processOutreach(new Date("2026-11-23T09:00:00Z"));
  expect(m.taskUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { requestKey: "outreach:c1" }, create: expect.objectContaining({ assignedToId: "u1", title: "Relancer pour la démo (pas de WhatsApp)" }) }));
  expect(saved()).toMatchObject({ status: "DONE" });
});
it("skips the task when the salon has no owner but still finishes", async () => {
  m.seqFindUnique.mockResolvedValue(seq({ step: 3, lastSentAt: now, conversation: conv({ salon: null }) }));
  await processOutreach(new Date("2026-11-23T09:00:00Z"));
  expect(m.taskUpsert).not.toHaveBeenCalled(); expect(saved()).toMatchObject({ status: "DONE" });
});
it("a number sent in reply acknowledges the reply and jumps to step 2", async () => {
  const replyAt = new Date("2026-11-18T12:00:00Z");
  m.seqFindUnique.mockResolvedValue(seq({ step: 1, lastSentAt: now }));
  m.msgFind.mockResolvedValue([inbound("écris-moi au 07 11 22 33 44", replyAt)]);
  await processOutreach(new Date("2026-11-18T12:01:00Z"));
  expect(saved()).toMatchObject({ step: 2, phone: "+33711223344", lastSentAt: replyAt });
});
it("retries a failed send in an hour, then stops after 3 attempts without leaking errors", async () => {
  m.meta.mockRejectedValue(new Error("boom"));
  await processOutreach(now);
  expect(saved()).toMatchObject({ lastError: expect.stringMatching(/^tentative 1\/3/), nextRunAt: new Date(now.getTime() + 3600000), leaseAt: null });
  m.seqUpdate.mockClear();
  m.seqFindUnique.mockResolvedValue(seq({ lastError: "tentative 2/3 : boom" }));
  await processOutreach(now);
  expect(saved()).toMatchObject({ status: "STOPPED", stopReason: "SEND_FAILED", nextRunAt: null });
});
