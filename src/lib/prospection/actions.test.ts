import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "rep", role: "COMMERCIAL" }, update: vi.fn(), taskUpdate: vi.fn(), prospect: vi.fn(), salonCreate: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/access", () => ({ requireMember: async () => state.user, requireAdmin: async () => { if (state.user.role !== "ADMIN") throw new Error("ADMIN_ONLY"); return state.user; }, prospectScope: (user: { id: string; role: string }) => user.role === "ADMIN" ? {} : { OR: [{ assignedToId: user.id }, { assignedToId: null, tournee: { assignedToId: user.id } }] } }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: state.transaction } }));
vi.mock("@/lib/slugs", () => ({ uniqueSalonSlug: async () => "salon-test" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import { convertProspect, discardProspect, generateTournee, releaseProspect } from "./actions";
const form = () => { const fd = new FormData(); fd.set("prospectId", "lead-other"); return fd; };
beforeEach(() => {
  vi.clearAllMocks(); state.user = { id: "rep", role: "COMMERCIAL" };
  state.transaction.mockImplementation(async fn => fn({ prospect: { updateMany: state.update, findFirst: state.prospect, update: state.update }, salesTask: { updateMany: state.taskUpdate }, salon: { create: state.salonCreate } }));
});
describe("prospect mutation permissions", () => {
  it("prevents a rep from generating or releasing global rounds", async () => {
    await expect(generateTournee(form())).rejects.toThrow("ADMIN_ONLY");
    await expect(releaseProspect(form())).rejects.toThrow("ADMIN_ONLY");
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it("cannot discard another salesperson’s prospect", async () => {
    state.update.mockResolvedValue({ count: 0 });
    await expect(discardProspect(form())).rejects.toThrow("REDIRECT:");
    expect(state.update.mock.calls[0][0].where.OR).toEqual([{ assignedToId: "rep" }, { assignedToId: null, tournee: { assignedToId: "rep" } }]);
    expect(state.taskUpdate).not.toHaveBeenCalled();
  });
  it("cannot convert a prospect outside the rep’s ownership", async () => {
    state.prospect.mockResolvedValue(null);
    await expect(convertProspect(form())).rejects.toThrow("REDIRECT:");
    expect(state.salonCreate).not.toHaveBeenCalled();
  });
  it("creates the salon and transfers tasks inside the same transaction", async () => {
    state.prospect.mockResolvedValue({ id: "lead-other", name: "Salon", status: "EN_TOURNEE", metiers: [], source: "GOOGLE", sourceUrl: "https://maps.google.com/test", assignedToId: "rep" });
    state.update.mockResolvedValue({ count: 1 });
    state.salonCreate.mockResolvedValue({ id: "salon" });
    await expect(convertProspect(form())).rejects.toThrow("REDIRECT:/prospection");
    expect(state.salonCreate.mock.calls[0][0].data.bookingUrl).toBeNull();
    expect(state.salonCreate.mock.calls[0][0].data.assignedToId).toBe("rep");
    expect(state.taskUpdate).toHaveBeenCalledWith({ where: { prospectId: "lead-other" }, data: { salonId: "salon" } });
    expect(state.transaction).toHaveBeenCalledTimes(1);
  });
});
