import { describe, expect, it } from "vitest";
import { diffServices, type ExistingService, type ScrapedService } from "./resync";

function existing(partial: Partial<ExistingService> & { id: string; service_name: string }): ExistingService {
  return {
    service_price: 10,
    duration_minutes: 30,
    discounted_price: 0,
    isActive: true,
    isDeleted: false,
    ...partial,
  };
}

function scraped(partial: Partial<ScrapedService> & { service_name: string }): ScrapedService {
  return {
    service_price: 10,
    duration_minutes: 30,
    ...partial,
  };
}

describe("diffServices", () => {
  it("reports an exact name+price+duration match as unchanged", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Browlift simple", service_price: 55, duration_minutes: 30 })],
      [scraped({ service_name: "Browlift simple", service_price: 55, duration_minutes: 30 })],
    );
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.updates).toHaveLength(0);
    expect(diff.creates).toHaveLength(0);
    expect(diff.deactivates).toHaveLength(0);
  });

  it("matches names case/accent/whitespace-insensitively", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Manucure Russe +  Extention Gel", service_price: 80, duration_minutes: 90 })],
      [scraped({ service_name: "manucure russe + extention gel", service_price: 80, duration_minutes: 90 })],
    );
    expect(diff.unchanged).toHaveLength(1);
  });

  it("emits a price/duration update when a matched service drifted", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Manucure Simple", service_price: 20, duration_minutes: 30 })],
      [scraped({ service_name: "Manucure Simple", service_price: 30, duration_minutes: 30 })],
    );
    expect(diff.updates).toEqual([
      {
        id: "a",
        service_name: "Manucure Simple",
        changes: { service_price: 30 },
        before: { service_price: 20, duration_minutes: 30 },
      },
    ]);
  });

  it("does not clobber an existing duration when the scraped duration is null", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Nail art", service_price: 0, duration_minutes: 90 })],
      [scraped({ service_name: "Nail art", service_price: 0, duration_minutes: null })],
    );
    expect(diff.unchanged).toHaveLength(1);
  });

  it("mirrors a drifted discounted_price that tracked the old price", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Baby-boomer", service_price: 10, discounted_price: 10, duration_minutes: 15 })],
      [scraped({ service_name: "Baby-boomer", service_price: 15, duration_minutes: 15 })],
    );
    expect(diff.updates[0].changes).toEqual({ service_price: 15, discounted_price: 15 });
  });

  it("creates services that only exist on the booking page", () => {
    const diff = diffServices([], [scraped({ service_name: "Manucure Japonaise", service_price: 60, duration_minutes: 60 })]);
    expect(diff.creates).toHaveLength(1);
    expect(diff.creates[0].service_name).toBe("Manucure Japonaise");
  });

  it("deactivates active services that vanished from the booking page", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Shading brows", service_price: 220, duration_minutes: 90 })],
      [],
    );
    expect(diff.deactivates).toEqual([{ id: "a", service_name: "Shading brows" }]);
  });

  it("leaves already-deleted services alone when they are absent from the page", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Gel X", isActive: false, isDeleted: true })],
      [],
    );
    expect(diff.deactivates).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it("restores a soft-deleted service that reappeared on the page, at the page's price", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Taille L", service_price: 10, discounted_price: 10, duration_minutes: 10, isActive: false, isDeleted: true })],
      [scraped({ service_name: "Taille L", service_price: 10, duration_minutes: 10 })],
    );
    expect(diff.restores).toEqual([
      {
        id: "a",
        service_name: "Taille L",
        changes: { isActive: true, isDeleted: false, service_price: 10, discounted_price: 0, duration_minutes: 10 },
      },
    ]);
  });

  it("prefers an active doc over a deleted one when both share a name", () => {
    const diff = diffServices(
      [
        existing({ id: "dead", service_name: "Dépose", service_price: 12, isActive: false, isDeleted: true }),
        existing({ id: "live", service_name: "Dépose", service_price: 10 }),
      ],
      [scraped({ service_name: "Dépose", service_price: 15 })],
    );
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].id).toBe("live");
    expect(diff.deactivates).toHaveLength(0);
  });

  it("dedupes identical scraped rows (same name, price, duration)", () => {
    const diff = diffServices(
      [],
      [
        scraped({ service_name: "Dépose", service_price: 15 }),
        scraped({ service_name: "Dépose", service_price: 15 }),
      ],
    );
    expect(diff.creates).toHaveLength(1);
  });

  it("pairs same-named entries by closest price when several coexist", () => {
    const diff = diffServices(
      [
        existing({ id: "cheap", service_name: "Dépose", service_price: 10 }),
        existing({ id: "steep", service_name: "Dépose", service_price: 40 }),
      ],
      [
        scraped({ service_name: "Dépose", service_price: 15 }),
        scraped({ service_name: "Dépose", service_price: 45 }),
      ],
    );
    const byId = Object.fromEntries(diff.updates.map((u) => [u.id, u.changes]));
    expect(byId.cheap).toEqual({ service_price: 15 });
    expect(byId.steep).toEqual({ service_price: 45 });
  });

  it("matches names across curly/straight apostrophe variants", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Réparation d’un ongle", service_price: 5, duration_minutes: 30, isActive: false, isDeleted: true })],
      [scraped({ service_name: "Réparation d'un ongle", service_price: 5, duration_minutes: 30 })],
    );
    expect(diff.creates).toHaveLength(0);
    expect(diff.restores).toHaveLength(1);
    expect(diff.restores[0].id).toBe("a");
  });

  it("keeps (never deactivates) a 0€ sur-devis doc absent from the scrape, and reports it", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Nail art", service_price: 0, duration_minutes: 90 })],
      [],
    );
    expect(diff.deactivates).toHaveLength(0);
    expect(diff.kept).toEqual([{ id: "a", service_name: "Nail art" }]);
  });

  it("reactivates a paused (inactive, non-deleted) doc that still exists on the page", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Browlift simple", service_price: 55, duration_minutes: 30, isActive: false })],
      [scraped({ service_name: "Browlift simple", service_price: 55, duration_minutes: 30 })],
    );
    expect(diff.updates).toEqual([
      {
        id: "a",
        service_name: "Browlift simple",
        changes: { isActive: true },
        before: { service_price: 55, duration_minutes: 30 },
      },
    ]);
  });

  it("clamps a stale real discount when the page price drops below it", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Soin", service_price: 50, discounted_price: 40, duration_minutes: 30 })],
      [scraped({ service_name: "Soin", service_price: 35, duration_minutes: 30 })],
    );
    expect(diff.updates[0].changes).toEqual({ service_price: 35, discounted_price: 35 });
  });

  it("keeps a still-valid real discount untouched when the price stays above it", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Soin", service_price: 50, discounted_price: 40, duration_minutes: 30 })],
      [scraped({ service_name: "Soin", service_price: 45, duration_minutes: 30 })],
    );
    expect(diff.updates[0].changes).toEqual({ service_price: 45 });
  });

  it("breaks exact ties deterministically by doc id, regardless of input order", () => {
    const a = existing({ id: "aaa", service_name: "Dépose", service_price: 15 });
    const b = existing({ id: "bbb", service_name: "Dépose", service_price: 15 });
    const page = [scraped({ service_name: "Dépose", service_price: 20 })];
    const first = diffServices([a, b], page);
    const second = diffServices([b, a], page);
    expect(first.updates[0].id).toBe("aaa");
    expect(second.updates[0].id).toBe("aaa");
    expect(first.deactivates[0].id).toBe("bbb");
    expect(second.deactivates[0].id).toBe("bbb");
  });

  it("applies caller aliases to pair renamed services instead of create+deactivate", () => {
    const diff = diffServices(
      [existing({ id: "a", service_name: "Pose extensions de cils volume russe", service_price: 80, duration_minutes: 90 })],
      [scraped({ service_name: "Pose extensions de cils volume russe léger", service_price: 90, duration_minutes: 120 })],
      { aliases: { "Pose extensions de cils volume russe léger": "Pose extensions de cils volume russe" } },
    );
    expect(diff.deactivates).toHaveLength(0);
    expect(diff.creates).toHaveLength(0);
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].changes).toEqual({
      service_name: "Pose extensions de cils volume russe léger",
      service_price: 90,
      duration_minutes: 120,
    });
  });

  it("never lets an alias steal a doc already claimed by an exact match", () => {
    const diff = diffServices(
      [existing({ id: "live", service_name: "Dépose", service_price: 10 })],
      [
        scraped({ service_name: "Dépose", service_price: 15 }),
        scraped({ service_name: "Dépose Gel", service_price: 15 }),
      ],
      { aliases: { "Dépose Gel": "Dépose" } },
    );
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].id).toBe("live");
    expect(diff.creates).toHaveLength(1);
    expect(diff.creates[0].service_name).toBe("Dépose Gel");
  });
});
