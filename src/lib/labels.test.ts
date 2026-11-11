import { describe, expect, it } from "vitest";
import { ACCOUNT_ATTENTION_LABEL, ACCOUNT_ATTENTION_STYLE } from "./labels";

describe("account attention labels", () => {
  it("shows the demo chips with a style each", () => {
    expect(ACCOUNT_ATTENTION_LABEL.demo_to_book).toBe("Démo à réserver");
    expect(ACCOUNT_ATTENTION_LABEL.demo_booked).toBe("Démo réservée");
    expect(ACCOUNT_ATTENTION_STYLE.demo_to_book).toBeTruthy();
    expect(ACCOUNT_ATTENTION_STYLE.demo_booked).toBeTruthy();
  });
  it("keeps pro_preview and self_serve detail-only", () => {
    expect(ACCOUNT_ATTENTION_LABEL.pro_preview).toBeUndefined();
    expect(ACCOUNT_ATTENTION_LABEL.self_serve).toBeUndefined();
  });
});
