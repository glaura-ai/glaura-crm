import { beforeEach, expect, it, vi } from "vitest";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/outreach/booking", async orig => ({ ...await orig<typeof import("@/lib/outreach/booking")>(), recordClickAndResolve: resolve }));
import { GET } from "./route";

const call = (token = "t", ua = "Mozilla/5.0 Chrome/120") => GET(new Request("https://crm.test/demo/" + token, { headers: { "user-agent": ua } }), { params: Promise.resolve({ token }) });
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

it("302-redirects to the resolved calendar", async () => {
  resolve.mockResolvedValue("https://cal.test/a");
  const res = await call();
  expect(res.status).toBe(302); expect(res.headers.get("location")).toBe("https://cal.test/a");
  expect(resolve).toHaveBeenCalledWith("t", { count: true });
});
it("never errors: falls back to the default calendar when resolution throws", async () => {
  resolve.mockRejectedValue(new Error("db down"));
  const res = await call();
  expect(res.status).toBe(302); expect(res.headers.get("location")).toMatch(/^https:\/\//);
});
it("does not count link-preview fetches", async () => {
  resolve.mockResolvedValue("https://cal.test/a");
  await call("t", "facebookexternalhit/1.1");
  expect(resolve).toHaveBeenCalledWith("t", { count: false });
});
