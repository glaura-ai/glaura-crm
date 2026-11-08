import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ find: vi.fn(), count: vi.fn(), rounds: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { prospect: { findMany: state.find, count: state.count }, tournee: { findMany: state.rounds } } }));
vi.mock("@/lib/access", () => ({ prospectScope: (user: { id: string; role: string }) => user.role === "ADMIN" ? {} : { OR: [{ assignedToId: user.id }, { assignedToId: null, tournee: { assignedToId: user.id } }] } }));
import { getProspectPool, getTodaysTournees } from "./queries";
beforeEach(() => { vi.clearAllMocks(); state.find.mockResolvedValue([]); state.count.mockResolvedValue(0); state.rounds.mockResolvedValue([]); });
it("keeps owner restrictions when an admin searches by name", async () => {
  await getProspectPool({ id: "admin", role: "ADMIN" }, { owner: "rep", q: "Salon" });
  const where = state.find.mock.calls[0][0].where;
  expect(where.AND[1].OR).toContainEqual({ assignedToId: "rep" });
  expect(where.OR).toContainEqual({ name: { contains: "Salon", mode: "insensitive" } });
});
it("cannot use filters to escape sales ownership", async () => {
  await getProspectPool({ id: "rep", role: "COMMERCIAL" }, { owner: "someone-else", q: "Salon", page: "2.5" });
  const query = state.find.mock.calls[0][0];
  expect(query.where.AND[0].OR).toContainEqual({ assignedToId: "rep" });
  expect(query.skip).toBe(50);
  expect(query.take).toBe(50);
});
it("includes unfinished old rounds while filtering their prospect rows by owner", async () => {
  await getTodaysTournees(new Date("2026-11-08T12:00:00Z"), "rep");
  const query = state.rounds.mock.calls[0][0];
  expect(query.where.assignedToId).toBe("rep");
  expect(query.where.OR[1].prospects.some.status).toBe("EN_TOURNEE");
  expect(query.include.prospects.where.OR).toEqual([{ assignedToId: "rep" }, { assignedToId: null }]);
});
it("only includes verified dual-platform salons in the dedicated filter", async () => {
  await getProspectPool({ id: "rep", role: "COMMERCIAL" }, { platform: "both" });
  const where = state.find.mock.calls[0][0].where;
  expect(where).toMatchObject({ treatwellUrl: { not: null }, planityUrl: { not: null }, dualPlatformCheckedAt: { not: null } });
  expect(where.AND[0].OR).toContainEqual({ assignedToId: "rep" });
});
