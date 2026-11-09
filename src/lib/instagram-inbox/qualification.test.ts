import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { parse: state.parse }; } }));
import { classifyLead, qualificationHash } from "./qualification";
const message = { id: "incoming-1", text: "Je suis intéressée, pouvons-nous prévoir une démo ?", sentAt: new Date("2026-11-09T10:00:00Z"), incoming: true };
beforeEach(() => { vi.clearAllMocks(); });
it("classifies the latest incoming message with bounded context and validated output", async () => {
  state.parse.mockResolvedValue({ parsed_output: { temperature: "CHAUD", reason: "Demande explicite de démonstration.", action: "Proposer deux créneaux de démonstration", confidence: "HIGH" } });
  const result = await classifyLead(message, [{ ...message, text: "Notre offre vous intéresse ?", incoming: false }], new Date("2026-11-09T11:00:00Z"));
  expect(result.temperature).toBe("CHAUD");
  const request = state.parse.mock.calls[0][0];
  expect(request.messages[0].content).toContain('"latestIncoming"');
  expect(request.messages[0].content).toContain(message.text);
  expect(request.system).toContain("instructions");
});
it("requires rechecking stale leads rather than treating old interest as current", async () => {
  expect((await classifyLead(message, [], new Date("2027-01-01"))).temperature).toBe("A_RECONTACTER");
  expect(state.parse).not.toHaveBeenCalled();
});
it("does not infer interest from attachments or deleted message placeholders", async () => {
  for (const text of ["[Pièce jointe — consulter Instagram]", "[Message supprimé]", ""]) expect((await classifyLead({ ...message, text }, [], new Date("2026-11-09T11:00:00Z"))).temperature).toBe("A_RECONTACTER");
  expect(state.parse).not.toHaveBeenCalled();
});
it("rejects an outgoing message as the basis of qualification", async () => {
  await expect(classifyLead({ ...message, incoming: false }, [])).rejects.toThrow();
});
it("uses content hashes so edits invalidate a classification even with the same message ID", () => {
  expect(qualificationHash("Oui")).not.toBe(qualificationHash("Non"));
});
it("downgrades uncertain AI decisions to a human recheck", async () => {
  state.parse.mockResolvedValue({ parsed_output: { temperature: "CHAUD", reason: "Réponse ambiguë.", action: "Demander une précision", confidence: "LOW" } });
  expect((await classifyLead(message, [], new Date("2026-11-09T11:00:00Z"))).temperature).toBe("A_RECONTACTER");
});
