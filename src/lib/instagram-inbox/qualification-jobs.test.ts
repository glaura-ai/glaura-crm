import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ latest: vi.fn(), update: vi.fn(), transaction: vi.fn(), salon: vi.fn(), conversation: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { instagramMessage: { findFirst: mocks.latest }, instagramConversation: { updateMany: mocks.update }, $transaction: mocks.transaction } }));
import { requireLatestIncoming, queueLeadQualification, persistQualification } from "./qualification-jobs";
const message = { id: "m1", text: "Oui pour une démo", sentAt: new Date("2026-11-09T10:00:00Z"), incoming: true };
const result = { temperature: "CHAUD" as const, reason: "Demande de démo", action: "Proposer un créneau", confidence: "HIGH" as const };
beforeEach(() => {
  vi.clearAllMocks(); mocks.latest.mockResolvedValue(message); mocks.update.mockResolvedValue({ count: 1 });
  mocks.conversation.mockResolvedValue({ salonId: "salon" });
  mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: vi.fn(), instagramMessage: { findFirst: mocks.latest }, instagramConversation: { updateMany: mocks.update, findUniqueOrThrow: mocks.conversation }, salon: { updateMany: mocks.salon } }));
});
it("requires the actual latest incoming message before queueing", async () => {
  await expect(queueLeadQualification("thread", "older-message")).rejects.toThrow("nouveau message");
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.latest).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: "thread", incoming: true } }));
});
it("rejects conversations without incoming evidence", async () => {
  mocks.latest.mockResolvedValue(null);
  await expect(requireLatestIncoming("thread", "m1")).rejects.toThrow();
});
it("discards a classification if a newer message arrived during inference", async () => {
  mocks.latest.mockResolvedValue({ ...message, id: "m2", text: "Finalement non merci" });
  expect(await persistQualification("thread", message, result, "AI", new Date())).toBe(false);
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.salon).not.toHaveBeenCalled();
});
it("discards a classification if the source text was deleted or edited", async () => {
  mocks.latest.mockResolvedValue({ ...message, text: "[Message supprimé]" });
  expect(await persistQualification("thread", message, result, "AI", new Date())).toBe(false);
});
it("fences old AI work and shares only temperature with the lead", async () => {
  const lease = new Date();
  expect(await persistQualification("thread", message, result, "AI", lease)).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "thread", qualificationPending: true, qualificationStartedAt: lease } }));
  expect(mocks.salon.mock.calls[0][0].data).toEqual({ leadTemperature: "CHAUD" });
});
it("does not overwrite a manual correction or a newer worker lease", async () => {
  mocks.update.mockResolvedValue({ count: 0 });
  expect(await persistQualification("thread", message, result, "AI", new Date())).toBe(false);
  expect(mocks.salon).not.toHaveBeenCalled();
});
it("rejects an old form after the same incoming message was edited", async () => {
  await expect(requireLatestIncoming("thread", "m1", "old-content-hash")).rejects.toThrow("nouveau message");
});
