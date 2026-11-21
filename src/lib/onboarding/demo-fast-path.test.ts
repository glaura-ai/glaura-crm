import { describe, expect, it } from "vitest";
import {
  buildOptions,
  expandDoneData,
  isLauraDemoJob,
  LAURA_DEMO_EXTRACT_CHUNK_SIZE,
  LAURA_DEMO_JOB_WHERE,
  LAURA_DEMO_POLL_MS,
} from "./demo-fast-path";
import { mergeChunkedExtracts, sliceInChunks } from "./extract";

describe("isLauraDemoJob", () => {
  it("only matches the laura_demo identity channel", () => {
    expect(isLauraDemoJob({ identityChannel: "laura_demo" })).toBe(true);
    expect(isLauraDemoJob({ identityChannel: "sms" })).toBe(false);
    expect(isLauraDemoJob({ identityChannel: "instagram" })).toBe(false);
    expect(isLauraDemoJob(null)).toBe(false);
    expect(isLauraDemoJob(undefined)).toBe(false);
  });
});

describe("buildOptions", () => {
  it("is latency-first for the Laura demo", () => {
    expect(buildOptions({ identityChannel: "laura_demo" })).toEqual({
      expand: { fast: true },
      extract: { chunkSize: LAURA_DEMO_EXTRACT_CHUNK_SIZE },
    });
  });

  it("leaves the normal onboarding flow untouched", () => {
    expect(buildOptions({ identityChannel: "instagram" })).toEqual({ expand: undefined, extract: undefined });
    expect(buildOptions(undefined)).toEqual({ expand: undefined, extract: undefined });
  });
});

describe("demo lane polling", () => {
  it("polls fast and only for QUEUED laura_demo jobs", () => {
    expect(LAURA_DEMO_POLL_MS).toBeLessThanOrEqual(3_000);
    expect(LAURA_DEMO_JOB_WHERE).toEqual({
      status: "QUEUED",
      config: { path: ["identityChannel"], equals: "laura_demo" },
    });
  });
});

describe("expandDoneData", () => {
  const expanded = { sourceType: "planity", title: "Pur", html: "<html/>" };

  it("adds the deterministic first look for the demo", () => {
    const data = expandDoneData(expanded, {
      name: "Pur - Saint Germain",
      serviceCount: 161,
      serviceNames: [" Coupe ", "Brushing", "A", "B", "C", "D"],
    });
    expect(data).toMatchObject({ name: "Pur - Saint Germain", serviceCount: 161, htmlBytes: 7 });
    expect("sampleServices" in data && data.sampleServices).toEqual(["Coupe", "Brushing", "A", "B", "C"]);
  });

  it("keeps the legacy shape without a preview", () => {
    expect(expandDoneData(expanded, null)).toEqual({ sourceType: "planity", title: "Pur", htmlBytes: 7 });
  });
});

describe("chunked extraction helpers", () => {
  it("slices consecutive chunks and keeps the remainder", () => {
    const chunks = sliceInChunks(Array.from({ length: 45 }, (_, i) => i), 20);
    expect(chunks.map((chunk) => chunk.length)).toEqual([20, 20, 5]);
    expect(chunks.flat()).toEqual(Array.from({ length: 45 }, (_, i) => i));
    expect(sliceInChunks([], 20)).toEqual([]);
  });

  it("merges slice services in page order onto the header", () => {
    const service = (name: string) => ({
      service_name: name,
      subcategory_name: "S",
      category: "Coiffure" as const,
      service_details: "",
      service_price: 1,
      duration_minutes: 10,
    });
    const header = {
      salon: { name: "Pur", address: null, phone: null, bio: null, images: ["i"], hours: {} },
      services: [],
      staff: ["Ana"],
    };
    const slice = (...names: string[]) => ({ ...header, salon: { ...header.salon, name: "" }, services: names.map(service), staff: [] });
    const merged = mergeChunkedExtracts(header, [slice("a", "b"), slice("c")]);
    expect(merged.services.map((s) => s.service_name)).toEqual(["a", "b", "c"]);
    expect(merged.salon.name).toBe("Pur");
    expect(merged.staff).toEqual(["Ana"]);
  });
});
