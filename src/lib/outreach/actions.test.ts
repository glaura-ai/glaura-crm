import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), conversation: vi.fn(), create: vi.fn(), updateMany: vi.fn(), salonUpdate: vi.fn(), convUpdate: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/access", () => ({ requireInstagramAdmin: mocks.admin }));
vi.mock("./config", () => ({ outreachEnabled: mocks.enabled }));
const tx = { outreachSequence: { updateMany: mocks.updateMany }, salon: { updateMany: mocks.salonUpdate }, instagramConversation: { update: mocks.convUpdate } };
vi.mock("@/lib/db", () => ({ prisma: { instagramConversation: { findUnique: mocks.conversation }, outreachSequence: { create: mocks.create, updateMany: mocks.updateMany }, $transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx) } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { markDemoBooked, startOutreach, stopOutreach } from "./actions";
const form = () => { const fd = new FormData(); fd.set("conversationId", "c1"); return fd; };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ id: "u1" }); mocks.enabled.mockReturnValue(true);
  mocks.conversation.mockResolvedValue({ id: "c1", salonId: "s1", qualification: "CHAUD", resolvedAt: null, outreach: null });
});
it("refuses to start when disabled", async () => {
  mocks.enabled.mockReturnValue(false);
  await expect(startOutreach(form())).rejects.toThrow("d%C3%A9sactiv%C3%A9e");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("never restarts an existing sequence", async () => {
  mocks.conversation.mockResolvedValue({ id: "c1", qualification: null, resolvedAt: null, outreach: { status: "STOPPED" } });
  await expect(startOutreach(form())).rejects.toThrow("error=");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("refuses cold or treated conversations", async () => {
  for (const c of [{ qualification: "FROID", resolvedAt: null }, { qualification: null, resolvedAt: new Date() }]) {
    mocks.conversation.mockResolvedValue({ id: "c1", outreach: null, ...c });
    await expect(startOutreach(form())).rejects.toThrow("error=");
  }
  expect(mocks.create).not.toHaveBeenCalled();
});
it("creates an active sequence for the current user", async () => {
  await expect(startOutreach(form())).rejects.toThrow("/instagram?conversation=c1");
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "c1", status: "ACTIVE", step: 0, startedById: "u1", nextRunAt: expect.any(Date) }) });
});
it("stops an active sequence manually", async () => {
  await expect(stopOutreach(form())).rejects.toThrow("/instagram");
  expect(mocks.updateMany).toHaveBeenCalledWith({ where: { conversationId: "c1", status: "ACTIVE" }, data: { status: "STOPPED", stopReason: "MANUAL", nextRunAt: null } });
});
it("marks the demo booked: stops the sequence, relabels only unset/demo_to_book salons, treats the conversation", async () => {
  await expect(markDemoBooked(form())).rejects.toThrow("/instagram");
  expect(mocks.updateMany).toHaveBeenCalledWith({ where: { conversationId: "c1", status: "ACTIVE" }, data: { status: "STOPPED", stopReason: "DEMO_BOOKED", nextRunAt: null } });
  expect(mocks.salonUpdate).toHaveBeenCalledWith({ where: { id: "s1", archivedAt: null, OR: [{ accountStatusLabel: null }, { accountStatusLabel: "demo_to_book" }] }, data: { accountStatusLabel: "demo_booked" } });
  expect(mocks.convUpdate).toHaveBeenCalledWith({ where: { id: "c1" }, data: { waitingAt: null, resolvedAt: expect.any(Date) } });
});
it("skips the salon update without a linked salon", async () => {
  mocks.conversation.mockResolvedValue({ id: "c1", salonId: null, outreach: null });
  await expect(markDemoBooked(form())).rejects.toThrow("/instagram");
  expect(mocks.salonUpdate).not.toHaveBeenCalled();
});
it("rejects a missing conversation", async () => {
  mocks.conversation.mockResolvedValue(null);
  await expect(stopOutreach(form())).rejects.toThrow("error=");
});
