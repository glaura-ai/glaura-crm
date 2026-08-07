import { describe, expect, it } from "vitest";
import {
  BOOKING_REFUND_SUBJECT,
  bookingRefundRequestSchema,
  formatEuros,
  renderBookingRefundEmail,
} from "./booking-refund";

const data = {
  customerName: "Marie",
  salonName: "Studio <Camille>",
  serviceName: "Balayage",
  bookingDate: "lundi 10 août 2026",
  bookingTime: "14:30",
  refundAmountEuros: 39.5,
};

describe("booking refund request", () => {
  it("accepts the Cloud Functions payload", () => {
    const parsed = bookingRefundRequestSchema.safeParse({ to: "cliente@example.com", data });
    expect(parsed.success).toBe(true);
  });

  it("accepts an unknown customer, whose greeting has no name", () => {
    const parsed = bookingRefundRequestSchema.safeParse({
      to: "cliente@example.com",
      data: { ...data, customerName: "" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a bad recipient, a missing field or a negative refund", () => {
    expect(bookingRefundRequestSchema.safeParse({ to: "pas-un-email", data }).success).toBe(false);
    expect(bookingRefundRequestSchema.safeParse({ to: "cliente@example.com", data: { ...data, serviceName: "" } }).success).toBe(false);
    expect(bookingRefundRequestSchema.safeParse({ to: "cliente@example.com", data: { ...data, refundAmountEuros: -1 } }).success).toBe(false);
    expect(bookingRefundRequestSchema.safeParse({ to: "cliente@example.com", data: { ...data, refundAmountEuros: "39" } }).success).toBe(false);
  });
});

describe("booking refund amount", () => {
  it("writes euros the French way, and only shows cents when there are any", () => {
    expect(formatEuros(39)).toBe("39");
    expect(formatEuros(39.5)).toBe("39,50");
    expect(formatEuros(0)).toBe("0");
    expect(formatEuros(12.345)).toBe("12,35");
  });
});

describe("booking refund email", () => {
  it("renders the booking, the refund and an escaped salon name", () => {
    const email = renderBookingRefundEmail(data);
    expect(email.subject).toBe(BOOKING_REFUND_SUBJECT);
    expect(email.html).toContain("Bonjour Marie,");
    expect(email.html).toContain("Studio &lt;Camille&gt;");
    expect(email.html).toContain("Balayage");
    expect(email.html).toContain("lundi 10 août 2026");
    expect(email.html).toContain("14:30");
    expect(email.html).toContain("39,50 €");
    expect(email.html).toContain("cid:glaura-logo");
    expect(email.html).not.toContain("{{");
  });

  it("greets an unknown customer without a dangling space", () => {
    const email = renderBookingRefundEmail({ ...data, customerName: "" });
    expect(email.html).toContain("Bonjour,");
    expect(email.html).not.toContain("Bonjour ,");
    expect(email.text.startsWith("Bonjour,")).toBe(true);
  });

  it("carries a plaintext alternative with the refund delay", () => {
    const email = renderBookingRefundEmail(data);
    expect(email.text).toContain("Bonjour Marie,");
    expect(email.text).toContain("39,50 €");
    expect(email.text).toContain("5 à 10 jours ouvrés");
    expect(email.text).toContain("support@glaura.fr");
  });
});
