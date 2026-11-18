import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/outreach/actions", () => ({ startOutreach: vi.fn(), stopOutreach: vi.fn(), markDemoBooked: vi.fn() }));
vi.mock("./SubmitButton", () => ({ SubmitButton: ({ children }: { children: React.ReactNode }) => createElement("button", null, children) }));
import { OutreachPanel } from "./OutreachPanel";
const base = { enabled: true, autoStart: false, hidden: null, qualification: "CHAUD" as string | null, done: false, sequence: null };
const render = (p: Partial<Parameters<typeof OutreachPanel>[0]>) => renderToStaticMarkup(createElement(OutreachPanel, { ...base, ...p }));
const seq = { status: "ACTIVE", step: 1, nextRunAt: new Date("2026-11-20T09:00:00Z"), phone: "+33612345678", stopReason: null, lastError: null };
it("shows a disabled notice", () => { const h = render({ enabled: false }); expect(h).toContain("désactivée"); expect(h).not.toContain("Lancer la séquence"); });
it("offers to start when no sequence, with auto-start note", () => {
  const h = render({ autoStart: true }); expect(h).toContain("Lancer la séquence"); expect(h).toContain("Démarrage automatique"); expect(h).toContain("Démo réservée");
});
it("hides start for cold or done conversations", () => {
  expect(render({ qualification: "FROID" })).not.toContain("Lancer la séquence");
  expect(render({ done: true })).not.toContain("Lancer la séquence");
});
it("shows the active step, phone, error and stop button", () => {
  const h = render({ sequence: { ...seq, lastError: "boom" } });
  expect(h).toContain("Relance Instagram"); expect(h).toContain("+33612345678"); expect(h).toContain("boom"); expect(h).toContain("Arrêter");
});
it("shows the stop reason once stopped, and no book button when demo booked", () => {
  const h = render({ sequence: { ...seq, status: "STOPPED", stopReason: "DEMO_BOOKED" } });
  expect(h).toContain("Démo réservée"); expect(h).not.toContain("Arrêter"); expect(h).not.toContain("<button>Démo réservée");
  expect(render({ sequence: { ...seq, status: "STOPPED", stopReason: "REPLIED" } })).toContain("Le contact a répondu");
});
