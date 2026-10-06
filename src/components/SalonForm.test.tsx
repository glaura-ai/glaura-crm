import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import NewSalonPage from "@/app/(app)/salons/new/page";

vi.mock("@/components/AddressAutocomplete", () => ({ AddressAutocomplete: () => null }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: () => null }));
vi.mock("@/lib/actions", () => ({ createSalon: async () => {} }));

function formFromPage() {
  const page = NewSalonPage();
  const panel = page.props.children[2] as ReactElement<{ children: ReactElement<{ formToken: string }> }>;
  return panel.props.children;
}

describe("salon create form idempotency", () => {
  it("mints a distinct server token per new page render", () => {
    const first = formFromPage().props.formToken;
    expect(first).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    expect(formFromPage().props.formToken).not.toBe(first);
  });

  it("keeps the server token stable when rendering the same form again", () => {
    const form = formFromPage();
    const first = renderToStaticMarkup(form);
    const repeated = renderToStaticMarkup(form);
    expect(first).toContain(`name="formToken" value="${form.props.formToken}"`);
    expect(repeated).toContain(`name="formToken" value="${form.props.formToken}"`);
  });
});
