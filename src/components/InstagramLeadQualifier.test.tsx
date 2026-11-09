import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { InstagramConversation, InstagramMessage } from "@/generated/prisma/client";
vi.mock("@/lib/instagram-inbox/actions", () => ({ qualifyInstagramLead: vi.fn(), overrideInstagramQualification: vi.fn() }));
vi.mock("./SubmitButton", () => ({ SubmitButton: ({ children }: { children: React.ReactNode }) => createElement("button", null, children) }));
import { qualificationHash } from "@/lib/instagram-inbox/qualification";
import { InstagramLeadQualifier } from "./InstagramLeadQualifier";
const latest = { id: "message-id", text: "Synthetic private contact text", sentAt: new Date(), incoming: true } as InstagramMessage;
const conversation = { id: "conversation", qualification: "CHAUD", qualificationReason: "Demande explicite de démonstration", qualificationAction: "Proposer un créneau", qualificationSource: "AI", qualificationConfidence: "HIGH", qualificationPending: false, qualificationError: null, qualifiedMessageId: latest.id, qualifiedMessageHash: qualificationHash(latest.text) } as InstagramConversation;
it("shows the qualification, rationale, next action and source guard without copying the raw contact message", () => {
  const html = renderToStaticMarkup(createElement(InstagramLeadQualifier, { conversation, latest, hidden: null }));
  expect(html).toContain("Chaud"); expect(html).toContain("Demande explicite de démonstration"); expect(html).toContain("Proposer un créneau");
  expect(html).toContain('name="sourceMessageId"'); expect(html).toContain('name="sourceMessageHash"');
  expect(html).not.toContain(latest.text);
});
it("hides stale reasoning after the incoming message changes", () => {
  const html = renderToStaticMarkup(createElement(InstagramLeadQualifier, { conversation, latest: { ...latest, id: "new-message" }, hidden: null }));
  expect(html).toContain("À qualifier"); expect(html).not.toContain("Demande explicite de démonstration");
});
