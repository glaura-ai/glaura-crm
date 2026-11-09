import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), conversation: vi.fn(), update: vi.fn(), queue: vi.fn(), latest: vi.fn(), qualify: vi.fn(), persist: vi.fn(), transaction: vi.fn(), user: vi.fn(), config: vi.fn(), request: vi.fn(), store: vi.fn() }));
vi.mock("@/lib/access", () => ({ requireInstagramAdmin: mocks.admin }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction, user: { findFirst: mocks.user }, instagramConversation: { findUniqueOrThrow: mocks.conversation, update: mocks.update } } }));
vi.mock("./client", () => ({ inboxConfig: mocks.config, metaRequest: mocks.request }));
vi.mock("./store", () => ({ storeInstagramMessage: mocks.store }));
vi.mock("./qualification-jobs", () => ({ latestIncoming: mocks.latest, requireLatestIncoming: mocks.latest, queueLeadQualification: mocks.qualify, persistQualification: mocks.persist }));
vi.mock("./jobs", () => ({ requestInstagramSync: mocks.queue }));
vi.mock("./sync", () => ({ syncInstagramHistory: vi.fn() }));
vi.mock("./firebase-sync", () => ({ syncFirebaseInbox: vi.fn() }));
vi.mock("@/lib/slugs", () => ({ uniqueSalonSlug: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { replyInstagram } from "./actions";
const config = { accountId: "glaura-ig", host: "graph.instagram.com", token: "test-token" };
function form(text = " Bonjour ! ") {
  const fd = new FormData(); fd.set("conversationId", "glaura-ig:contact"); fd.set("text", text); return fd;
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T18:00:00Z"));
  mocks.admin.mockResolvedValue({ role: "ADMIN" });
  mocks.conversation.mockResolvedValue({ participantId: "contact", lastInboundAt: new Date("2026-11-08T17:00:00Z") });
  mocks.config.mockResolvedValue(config); mocks.request.mockResolvedValue({ message_id: "sent-id" });
});
afterEach(() => vi.useRealTimers());
it("sends an admin reply through the existing connection and stores the returned message", async () => {
  await expect(replyInstagram(form())).rejects.toThrow("/instagram?conversation=glaura-ig%3Acontact");
  expect(mocks.request).toHaveBeenCalledWith("glaura-ig/messages", { method: "POST", body: { recipient: { id: "contact" }, message: { text: "Bonjour !" } } }, config);
  expect(mocks.store).toHaveBeenCalledWith("glaura-ig", { id: "sent-id", participantId: "contact", incoming: false, text: "Bonjour !", sentAt: new Date() });
});
it("rejects unauthorized users before reading a conversation or contacting Meta", async () => {
  mocks.admin.mockRejectedValue(new Error("Forbidden"));
  await expect(replyInstagram(form())).rejects.toThrow("Forbidden");
  expect(mocks.conversation).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
});
it("blocks replies at the 24-hour boundary on the server", async () => {
  mocks.conversation.mockResolvedValue({ participantId: "contact", lastInboundAt: new Date("2026-11-07T18:00:00Z") });
  await expect(replyInstagram(form())).rejects.toThrow("error=");
  expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled();
});
it("does not record a sent message when Meta rejects delivery", async () => {
  mocks.request.mockRejectedValue(new Error("Meta refused delivery"));
  await expect(replyInstagram(form())).rejects.toThrow("error=Meta%20refused%20delivery");
  expect(mocks.store).not.toHaveBeenCalled();
});
it("rejects empty and oversized replies before contacting Meta", async () => {
  for (const text of ["  ", "x".repeat(1001)]) await expect(replyInstagram(form(text))).rejects.toThrow("error=");
  expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled();
});

it("changes inbox handling without changing the linked lead's sales status", async () => {
  const { setInstagramConversationState } = await import("./actions");
  for (const state of ["open", "waiting", "done"]) {
    const fd = form(); fd.set("state", state);
    await expect(setInstagramConversationState(fd)).rejects.toThrow("/instagram?");
    expect(mocks.update).toHaveBeenLastCalledWith({ where: { id: "glaura-ig:contact" }, data: {
      resolvedAt: state === "done" ? new Date() : null,
      waitingAt: state === "waiting" ? new Date() : null,
    } });
  }
});
it("rejects unauthorized handling changes before writing to the database", async () => {
  const { setInstagramConversationState } = await import("./actions");
  mocks.admin.mockRejectedValue(new Error("Forbidden"));
  const fd = form(); fd.set("state", "done");
  await expect(setInstagramConversationState(fd)).rejects.toThrow("Forbidden");
  expect(mocks.update).not.toHaveBeenCalled();
});
it("preserves the inbox filters after handling a conversation", async () => {
  const { setInstagramConversationState } = await import("./actions");
  const fd = form(); fd.set("state", "waiting"); fd.set("returnQuery", "view=all&filter=overdue&owner=sales-id&page=2");
  await expect(setInstagramConversationState(fd)).rejects.toThrow("/instagram?view=all&filter=overdue&owner=sales-id&page=2&conversation=glaura-ig%3Acontact");
});

it("returns promptly after queueing history without fetching provider data in the server action", async () => {
  const { syncInstagramInbox } = await import("./actions");
  await expect(syncInstagramInbox(form())).rejects.toThrow("/instagram?");
  expect(mocks.queue).toHaveBeenCalledOnce();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("does not queue an import for a user without private inbox access", async () => {
  const { syncInstagramInbox } = await import("./actions");
  mocks.admin.mockRejectedValue(new Error("Forbidden"));
  await expect(syncInstagramInbox(form())).rejects.toThrow("Forbidden");
  expect(mocks.queue).not.toHaveBeenCalled();
});

function taskForm() {
  const fd = form(); fd.set("requestKey", "7b85479e-9dca-4c88-85f0-4133ea275dd8"); fd.set("title", "Proposer une démo"); fd.set("context", ""); fd.set("assignedToId", "sales"); fd.set("dueAt", "2026-11-10"); fd.set("sourceMessageId", "latest-message"); fd.set("sourceMessageHash", "hash"); return fd;
}
it("rejects a task from an outdated message before assigning any work", async () => {
  const { createTaskFromInstagram } = await import("./actions");
  mocks.conversation.mockResolvedValue({ salonId: "salon" }); mocks.latest.mockRejectedValue(new Error("Un nouveau message est arrivé"));
  await expect(createTaskFromInstagram(taskForm())).rejects.toThrow("error=");
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("records the exact source message and shares only the explicit task context", async () => {
  const { createTaskFromInstagram } = await import("./actions");
  const message = { id: "latest-message", text: "Private message", incoming: true, sentAt: new Date() };
  mocks.conversation.mockResolvedValue({ salonId: "salon" }); mocks.latest.mockResolvedValue(message); mocks.user.mockResolvedValue({ id: "sales" });
  const task = vi.fn();
  mocks.transaction.mockImplementation(async work => work({ $queryRaw: vi.fn(), instagramConversation: { findUniqueOrThrow: vi.fn().mockResolvedValue({ salonId: "salon", qualificationPending: true }) }, instagramMessage: { findFirst: vi.fn().mockResolvedValue(message) }, salon: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "salon", assignedToId: "sales" }), update: vi.fn() }, salesTask: { upsert: task } }));
  await expect(createTaskFromInstagram(taskForm())).rejects.toThrow("/instagram?");
  expect(task).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ instagramMessageId: "latest-message", context: null }) }));
  expect(JSON.stringify(task.mock.calls)).not.toContain("Private message");
});
it("requires private inbox access before requesting qualification", async () => {
  const { qualifyInstagramLead } = await import("./actions");
  mocks.admin.mockRejectedValue(new Error("Forbidden"));
  await expect(qualifyInstagramLead(form())).rejects.toThrow("Forbidden");
  expect(mocks.qualify).not.toHaveBeenCalled();
});
