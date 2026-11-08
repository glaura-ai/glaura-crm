import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ crawl: vi.fn(), find: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { prospect: { findMany: state.find } } }));
vi.mock("./crawl", () => ({ crawlTargets: state.crawl }));
vi.mock("./upsert", () => ({ upsertProspects: state.upsert }));
import { pullTreatwellPlanity } from "./treatwell-planity";
const treatwell = { name: "Atelier Éclat", source: "TREATWELL", sourceUrl: "https://www.treatwell.fr/salon/eclat/", street: "9 rue Oberkampf", postalCode: "75011", zone: "paris-11", city: "Paris", rating: 4.8, reviewCount: 2, metiers: ["COIFFURE"] };
const planity = { ...treatwell, source: "PLANITY", sourceUrl: "https://www.planity.com/eclat-75011-paris", metiers: ["BARBIER"] };
beforeEach(() => {
  vi.clearAllMocks(); state.find.mockResolvedValue([]); state.upsert.mockResolvedValue({ created: 1, updated: 0 });
  state.crawl.mockResolvedValue({ prospects: [treatwell, planity], errors: [], pagesFetched: 2 });
});
it("retains both URLs and does not exclude a dual-platform salon with few reviews", async () => {
  expect(await pullTreatwellPlanity("paris-11", 50)).toContain("1 nouveau");
  const [rows, , options] = state.upsert.mock.calls[0];
  expect(rows[0]).toMatchObject({ source: "TREATWELL", treatwellUrl: treatwell.sourceUrl, planityUrl: planity.sourceUrl, dualPlatformCheckedAt: expect.any(Date), metiers: ["COIFFURE", "BARBIER"] });
  expect(options.minReviewCount).toBe(0);
});
it("does not import nonmatching salons or salons outside the selected zone", async () => {
  state.crawl.mockResolvedValue({ prospects: [treatwell, { ...planity, postalCode: "75012" }], errors: [] });
  await pullTreatwellPlanity("paris-11", 50);
  expect(state.upsert).not.toHaveBeenCalled();
});
it("preserves two existing lead histories instead of automatically merging their assignments", async () => {
  state.find.mockResolvedValue([{ id: "lead-treatwell" }, { id: "lead-planity" }]);
  expect(await pullTreatwellPlanity("paris-11", 50)).toContain("1 doublon(s) existant(s) à vérifier");
  expect(state.upsert).not.toHaveBeenCalled();
});
it("does not report a clean zero-match result when fetching pages failed", async () => {
  state.crawl.mockResolvedValue({ prospects: [treatwell], errors: ["HTTP 429"] });
  await expect(pullTreatwellPlanity("paris-11", 50)).rejects.toThrow("lus intégralement");
});
