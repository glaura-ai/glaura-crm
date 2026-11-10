import { describe, expect, it } from "vitest";
import { leadProvenance } from "./lead-provenance";

describe("lead provenance", () => {
  it("keeps the recorded acquisition channel separate from an Airtable import", () => {
    expect(leadProvenance({ source: "AIRTABLE", sourceLabel: "Instagram" })).toEqual({
      label: "Instagram", detail: "Import Airtable", url: null,
    });
  });
  it("uses a converted prospect's discovery source and URL", () => {
    expect(leadProvenance({ source: "SCRAPE", sourceLabel: "Prospection google", prospect: { source: "GOOGLE", sourceUrl: "https://maps.google.com/example" } })).toEqual({
      label: "Google", detail: "Prospection google", url: "https://maps.google.com/example",
    });
  });
  it("does not infer Instagram acquisition from a contact handle", () => {
    const salon = { source: "MANUAL" as const, instagram: "salon" };
    expect(leadProvenance(salon).label).toBe("Saisie manuelle");
    expect(leadProvenance({ source: "MANUAL", sourceLabel: "Instagram — message entrant" }).label).toBe("Instagram — message entrant");
  });
  it("shows missing import origins honestly and rejects unsafe source links", () => {
    expect(leadProvenance({ source: "AIRTABLE" }).label).toBe("Import Airtable");
    expect(leadProvenance({ source: "IMPORT", sourceLabel: "  " }).label).toBe("Import");
    expect(leadProvenance({ source: "SCRAPE", prospect: { source: "TREATWELL", sourceUrl: "javascript:alert(1)" } }).url).toBeNull();
  });
});
