import { expect, it, vi } from "vitest";
vi.mock("./client", () => ({ inboxConfig: vi.fn() }));
vi.mock("./store", () => ({ storeInstagramMessage: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({ getDb: vi.fn() }));
import { firebaseMessage } from "./firebase-sync";
it("excludes WhatsApp and Glaura chats from the shared Firebase collection", () => {
  for (const channel of ["whatsapp", "glaura"]) expect(firebaseMessage("mid", "person", { channel }, { text: "private", direction: "inbound", timestamp: new Date() })).toBeNull();
});
it("accepts legacy Instagram threads and preserves the inbound direction", () => {
  const date = new Date();
  expect(firebaseMessage("mid", "person", { participantUsername: "salon" }, { text: "Bonjour", direction: "inbound", timestamp: { toDate: () => date } })).toEqual({ id: "mid", participantId: "person", username: "salon", incoming: true, text: "Bonjour", sentAt: date });
});
it("does not expose deleted message content", () => {
  expect(firebaseMessage("mid", "person", {}, { text: "deleted content", deletedOnInstagram: true, direction: "outbound", timestamp: new Date() })?.text).toBe("[Message supprimé]");
});
