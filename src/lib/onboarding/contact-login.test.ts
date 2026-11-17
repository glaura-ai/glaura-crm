import { describe, expect, it, vi } from "vitest";
import { withSalonContactLogin } from "./contact-login";

const free = vi.fn(async () => false);
const taken = vi.fn(async () => true);

describe("withSalonContactLogin", () => {
  it("uses the CRM contact email as login and skips the welcome email", async () => {
    await expect(withSalonContactLogin(undefined, " Carla@iCloud.com ", free)).resolves.toEqual({
      loginEmail: "carla@icloud.com",
      sendWelcomeEmail: false,
    });
  });

  it("keeps the placeholder when the address is already a Firebase account", async () => {
    await expect(withSalonContactLogin(undefined, "carla@icloud.com", taken)).resolves.toBeUndefined();
  });

  it("ignores missing, malformed and internal addresses", async () => {
    for (const email of [null, "", "not-an-email", "x@glaura.fr"]) {
      await expect(withSalonContactLogin(undefined, email, free)).resolves.toBeUndefined();
    }
  });

  it("never overrides an explicit login, enrich mode or magic-link jobs", async () => {
    const explicit = { loginEmail: "owner@salon.fr" };
    const enrich = { mode: "enrich" as const, targetUid: "uid" };
    const magic = { magicLinkSignIn: true };
    for (const overrides of [explicit, enrich, magic]) {
      await expect(withSalonContactLogin(overrides, "carla@icloud.com", free)).resolves.toBe(overrides);
    }
  });
});
