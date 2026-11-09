import { expect, it } from "vitest";
import { conversationWhere, inboxHref, nextLeadAction } from "./tracking";
const now = new Date("2026-11-09T10:00:00Z");
it("separates open, waiting and handled conversations", () => {
  expect(conversationWhere({}, now)).toMatchObject({ resolvedAt: null, waitingAt: null });
  expect(conversationWhere({ view: "waiting" }, now)).toMatchObject({ resolvedAt: null, waitingAt: { not: null } });
  expect(conversationWhere({ view: "done" }, now)).toMatchObject({ resolvedAt: { not: null } });
});
it("combines assignment, sales status and follow-up filters without replacing the conversation state", () => {
  expect(conversationWhere({ view: "waiting", filter: "overdue", status: "INTERESSE", owner: "sales-id" }, now)).toMatchObject({
    resolvedAt: null, waitingAt: { not: null },
    AND: expect.arrayContaining([
      { salon: { is: { status: "INTERESSE" } } },
      { salon: { is: { assignedToId: "sales-id" } } },
    ]),
  });
});
it("finds unlinked leads and missing owners, including unlinked conversations", () => {
  expect(conversationWhere({ filter: "unlinked" }, now)).toMatchObject({ AND: [{ salonId: null }] });
  expect(JSON.stringify(conversationWhere({ filter: "unassigned" }, now))).toContain('"assignedToId":null');
});
it("uses the next pending task before the legacy follow-up date", () => {
  const task = { title: "Appeler", dueAt: new Date("2026-11-10T10:00:00Z") };
  expect(nextLeadAction({ tasks: [task], nextActionAt: new Date("2026-11-08") }, now)).toEqual({ ...task, overdue: false });
  expect(nextLeadAction({ tasks: [], nextActionAt: new Date("2026-11-08") }, now)?.overdue).toBe(true);
  expect(nextLeadAction({ tasks: [], nextActionAt: null }, now)).toBeNull();
});
it("keeps filters across selection and pagination and drops unknown query parameters", () => {
  const url = new URL(inboxHref({ view: "waiting", filter: "overdue", owner: "sales-id", page: "2", conversation: "old", error: "old", evil: "x" }, { conversation: "new", page: null }), "https://crm.test");
  expect(Object.fromEntries(url.searchParams)).toEqual({ view: "waiting", filter: "overdue", owner: "sales-id", conversation: "new" });
});
it("filters by current lead qualification independently of sales stage", () => {
  expect(conversationWhere({ temperature: "CHAUD", status: "INTERESSE" }, now)).toMatchObject({ AND: expect.arrayContaining([{ qualification: "CHAUD", qualificationPending: false }, { salon: { is: { status: "INTERESSE" } } }]) });
  expect(inboxHref({ temperature: "CHAUD" }, { page: "2" })).toContain("temperature=CHAUD");
});
