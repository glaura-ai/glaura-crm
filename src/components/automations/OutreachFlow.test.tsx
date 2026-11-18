import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: ({ children }: { children: React.ReactNode }) => createElement("button", { type: "submit" }, children) }));
import { OutreachFlow } from "./OutreachFlow";
import { renderPreviewText } from "./types";

const initial = { autoStart: true, step0Text: "Salut {nom} : {lien_demo}", step1Text: "Rappel {lien_demo}", askPhoneText: "Ton numéro ?", step1DelayHours: "20", step2DelayDays: "2", step3DelayDays: "5", sendHourStart: "9", sendHourEnd: "20", template1: "tpl_one", template2: "tpl_two", templateLang: "fr", calendarUrl: "" };
const props = { initial, enabled: true, active: true, killed: false, waReady: true, defaultLink: "https://cal.example/demo", stepCounts: [3, 2, 1, 4], stats: { statuses: [{ key: "ACTIVE", label: "En cours", count: 10 }], reasons: [{ key: "DEMO_BOOKED", label: "Démo réservée", count: 7 }] }, stops: ["Une démo est réservée"], templateStatuses: { tpl_one: "APPROVED", tpl_two: "MISSING" } as const, saveAction: vi.fn(), toggleAction: vi.fn() };
const render = (over: Partial<Parameters<typeof OutreachFlow>[0]> = {}) => renderToStaticMarkup(createElement(OutreachFlow, { ...props, ...over }));
const tag = (html: string, id: string) => html.match(new RegExp(`<(?:section|div)[^>]*data-panel="${id}"[^>]*>`))?.[0] ?? "";

it("renders the nodes with their live values, counts and branches", () => {
  const h = render().toLowerCase();
  for (const t of ["déclencheur", "instagram", "délai", "whatsapp", "condition", "tâche", "arrêt"]) expect(h).toContain(t);
  for (const t of ["Automatique : leads chauds et tièdes", "Attendre 20 h après le dernier message", "Numéro WhatsApp donné ?", "Jour 2", "Jour 5", "tpl_one", "3 en cours", "4 en cours", "Oui", "Non", "Tâche commerciale pour le responsable du salon", "Une démo est réservée"]) expect(h).toContain(t.toLowerCase());
  expect(render({ initial: { ...initial, autoStart: false } })).toContain("Lancement manuel");
});
it("shows template review statuses and top bar state", () => {
  const h = render();
  for (const t of ["Approuvé", "Introuvable", "Séquence démo", "Active", "WhatsApp configuré"]) expect(h).toContain(t);
  expect(render({ templateStatuses: null })).not.toContain("Approuvé");
  expect(render({ active: false, killed: true })).toContain("Coupée sur le serveur");
});
it("shows stats when nothing is selected and only the selected panel otherwise", () => {
  const none = render();
  expect(tag(none, "stats")).not.toContain("hidden"); expect(none).toContain("Démo réservée : 7"); expect(tag(none, "ig1")).toContain("hidden");
  const sel = render({ initialSelected: "ig1" });
  expect(tag(sel, "stats")).toContain("hidden"); expect(tag(sel, "ig1")).not.toContain("hidden"); expect(tag(sel, "ig0")).toContain("hidden");
  expect(sel).toContain('aria-pressed="true"');
});
it("keeps every field in the single save form, visible or hidden", () => {
  const h = render();
  for (const name of ["enabled", "step0Text", "step1DelayHours", "step1Text", "askPhoneText", "step2DelayDays", "template1", "step3DelayDays", "template2", "autoStart", "sendHourStart", "sendHourEnd", "calendarUrl", "templateLang"]) expect(h, name).toContain(`name="${name}"`);
  expect(h.match(/<form/g)).toHaveLength(2);
  expect(h).toContain("Enregistrer"); expect(h).toContain("Couper la séquence");
});
it("previews the tracked /demo link (not the raw calendar) and a sample salon name", () => {
  expect(render({ initialSelected: "ig0" })).toContain("Salut Studio Léa : https://crm.glaura.ai/demo/");
  expect(render({ initial: { ...initial, calendarUrl: "https://x.test/book" }, initialSelected: "ig0" })).not.toContain("Salut Studio Léa : https://x.test/book");
  expect(renderPreviewText("{nom} {lien_demo} {lien_demo}", "L")).toBe("Studio Léa L L");
});
