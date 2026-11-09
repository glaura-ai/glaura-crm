import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), update: vi.fn(), find: vi.fn(), history: vi.fn(), firebase: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { instagramSync: { upsert: mocks.upsert, updateMany: mocks.update, findUnique: mocks.find } } }));
vi.mock("./sync", () => ({ syncInstagramHistory: mocks.history }));
vi.mock("./firebase-sync", () => ({ syncFirebaseInbox: mocks.firebase }));
import { requestInstagramSync, processInstagramSync } from "./jobs";
beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue({ count: 1 }); mocks.find.mockResolvedValue({ status: "QUEUED" }); mocks.history.mockResolvedValue({ conversations: 1, messages: 2 }); mocks.firebase.mockResolvedValue({ messages: 3 }); });
it("queues a sync without making any provider requests in the browser action", async () => {
  await requestInstagramSync();
  expect(mocks.upsert).toHaveBeenCalled();
  expect(mocks.update.mock.calls[0][0].where.status).toEqual({ notIn: ["QUEUED", "PROCESSING"] });
  expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.firebase).not.toHaveBeenCalled();
});
it("does not run work when another worker has already claimed it", async () => {
  mocks.update.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
  await processInstagramSync();
  expect(mocks.history).not.toHaveBeenCalled();
});
it("records progress and completion under the claimed lease", async () => {
  mocks.history.mockImplementation(async (_: unknown, options: { onProgress: (p: unknown) => Promise<void> }) => { await options.onProgress({ stage: "META", conversations: 2, messages: 5 }); });
  await processInstagramSync();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "PROCESSING", startedAt: expect.any(Date) }), data: expect.objectContaining({ metaConversations: 2, metaMessages: 5 }) }));
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DONE", finishedAt: expect.any(Date) }) }));
});
it("records a safe failure without leaking provider errors", async () => {
  mocks.history.mockRejectedValue(new Error("private-provider-url-with-secret"));
  await processInstagramSync();
  const failed = mocks.update.mock.calls.find(([arg]) => arg.data.status === "FAILED" && arg.data.error);
  expect(failed).toBeDefined(); expect(JSON.stringify(failed)).not.toContain("private-provider-url");
});
it("ends an unresponsive import with a visible failure instead of leaving it running forever", async () => {
  vi.useFakeTimers();
  try {
    mocks.history.mockImplementation(() => new Promise(() => {}));
    const processing = processInstagramSync();
    await vi.advanceTimersByTimeAsync(20 * 60000 + 1);
    await processing;
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", finishedAt: expect.any(Date) }) }));
  } finally { vi.useRealTimers(); }
});
