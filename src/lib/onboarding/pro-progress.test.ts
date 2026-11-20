import { describe, expect, it } from "vitest";
import { proPreviewToken } from "./pro-preview";
import { deriveProProgress, sampleServiceNames } from "./pro-progress";

const SECRET = "s".repeat(32);
const job = { id: "job1", status: "PROCESSING" };
const ev = (type: string, data: unknown = null) => ({ type, data });

describe("sampleServiceNames", () => {
  it("keeps 5 trimmed bounded strings", () => {
    const out = sampleServiceNames([" Coupe ", 3, "", "x".repeat(80), "a", "b", "c", "d"]);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe("Coupe");
    expect(out[1]).toHaveLength(60);
  });
});

describe("deriveProProgress", () => {
  it("walks the stages", () => {
    expect(deriveProProgress(job, [], SECRET).stage).toBe("queued");
    expect(deriveProProgress(job, [ev("job_started")], SECRET).stage).toBe("reading");
    const learning = deriveProProgress(job, [ev("job_started"), ev("expand_done", { sourceType: "planity" })], SECRET);
    expect(learning).toMatchObject({ stage: "learning", sourceType: "planity", previewToken: null });
    const preparing = deriveProProgress(job, [
      ev("expand_done", { sourceType: "planity" }),
      ev("extract_done", { name: "Salon", serviceCount: 12, staffCount: 3, sampleServices: ["Coupe"] }),
    ], SECRET);
    expect(preparing).toMatchObject({ stage: "preparing", salonName: "Salon", serviceCount: 12, staffCount: 3, sampleServices: ["Coupe"], previewToken: null });
  });

  it("returns the delivery token only when ready", () => {
    const ready = deriveProProgress({ id: "job1", status: "DONE" }, [ev("extract_done"), ev("preview_ready")], SECRET);
    expect(ready.stage).toBe("ready");
    expect(ready.previewToken).toBe(proPreviewToken("job1", SECRET));
  });

  it("treats failures and review_required as failed", () => {
    expect(deriveProProgress({ id: "j", status: "FAILED" }, [ev("job_started")], SECRET).stage).toBe("failed");
    expect(deriveProProgress(job, [ev("job_error")], SECRET).stage).toBe("failed");
    expect(deriveProProgress(job, [ev("extract_done"), ev("review_required")], SECRET)).toMatchObject({ stage: "failed", previewToken: null });
    expect(deriveProProgress({ id: "j", status: "REVIEW_REQUIRED" }, [], SECRET).stage).toBe("failed");
  });
});
