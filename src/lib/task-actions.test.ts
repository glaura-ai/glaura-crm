import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ member: vi.fn(), upsert: vi.fn(), finish: vi.fn() }));
vi.mock("@/lib/access", () => ({ requireMember: async () => ({ id: "rep", role: "COMMERCIAL" }), prospectScope: () => ({ assignedToId: "rep" }) }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findFirst: state.member }, salesTask: { upsert: state.upsert, updateMany: state.finish } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import { createSalesTask, finishSalesTask } from "./task-actions";
beforeEach(() => { vi.clearAllMocks(); state.member.mockResolvedValue({ id: "rep", active: true }); });
it("ignores a forged assignee on a salesperson’s task", async () => {
  const fd = new FormData();
  for (const [key, value] of Object.entries({ requestKey: "1f2e3d4c-1234-4234-8234-123456789012", title: "Appeler", assignedToId: "other-user", dueAt: "2026-11-09" })) fd.set(key, value);
  await expect(createSalesTask(fd)).rejects.toThrow("REDIRECT:/taches");
  expect(state.upsert.mock.calls[0][0].create.assignedToId).toBe("rep");
  expect(state.upsert.mock.calls[0][0].create).not.toHaveProperty("instagramConversationId");
});
it("cannot complete another salesperson’s task", async () => {
  state.finish.mockResolvedValue({ count: 0 });
  const fd = new FormData(); fd.set("id", "other-task"); fd.set("outcome", "Appel effectué");
  await expect(finishSalesTask(fd)).rejects.toThrow("inaccessible");
  expect(state.finish.mock.calls[0][0].where).toEqual({ id: "other-task", doneAt: null, assignedToId: "rep" });
});
