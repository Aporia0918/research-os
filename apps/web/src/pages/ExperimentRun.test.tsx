import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { renderPage } from "@/test/pageHarness";
import { ExperimentRunPage } from "./ExperimentRun";
vi.mock("@/components/layout/AppShell", () => ({ PageHeader: () => null }));
afterEach(() => { vi.restoreAllMocks(); });
it("shows failed task status and detector evidence with unverified metrics", async () => {
  vi.spyOn(api, "get").mockImplementation((p) => Promise.resolve(p === "/tasks/t" ? { id: "t", state: "failed", error_message: "Detector blocked run" } : p === "/tasks/t/runs" ? [{ id: "r", attempt: 1, state: "failed" }] : { id: "r", state: "failed", metrics: [{ name: "score", split: "val", value: 0.9, verification: "failed" }], signals: [{ id: "d", detector: "split_integrity", severity: "error", rule: "overlapping groups", value: { overlap: 3 }, selector: { split: "val" } }] }));
  const p = await renderPage(<ExperimentRunPage />, "/experiments/tasks/:taskId", "/experiments/tasks/t");
  try { await p.flush(); expect(p.host.textContent).toContain("Detector blocked run"); expect(p.host.textContent).toContain("overlapping groups"); expect(p.host.textContent).toContain("failed"); } finally { await p.dispose(); }
});
it("shows an explicit empty state before a worker creates a run", async () => {
  vi.spyOn(api, "get").mockImplementation((p) => Promise.resolve(p.endsWith("/runs") ? [] : { id: "t", state: "queued" }));
  const p = await renderPage(<ExperimentRunPage />, "/experiments/tasks/:taskId", "/experiments/tasks/t");
  try { expect(p.host.textContent).toContain("No run attempts yet"); } finally { await p.dispose(); }
});
it("renders a read error instead of inventing run status", async () => {
  vi.spyOn(api, "get").mockRejectedValue(new Error("Run unavailable"));
  const p = await renderPage(<ExperimentRunPage />, "/experiments/tasks/:taskId", "/experiments/tasks/t");
  try { expect(p.host.textContent).toContain("Run unavailable"); expect(p.host.textContent).not.toContain("succeeded"); } finally { await p.dispose(); }
});
it("compares explicit evidence mappings and displays server outcomes and candidate causes", async () => {
  vi.spyOn(api, "get").mockImplementation(p => Promise.resolve(p === "/tasks/t" ? { id: "t", state: "succeeded" } : p.endsWith("/runs") ? [{ id: "r" }] : { id: "r", metrics: [], signals: [] }));
  const post = vi.spyOn(api, "post").mockResolvedValue({ run_id: "r", items: [
    { metric: "score", split: "val", reported_value: 0.8, reproduced_value: 0.7, status: "deviation", tolerance: { kind: "relative", value: 0.01 }, candidate_causes: [{ label: "candidate cause", name: "batch", paper_value: 32, plan_value: 16, run_value: 8 }] },
    { metric: "missing", split: "test", reported_value: null, reproduced_value: null, status: "not comparable", reason: "evidence stale", tolerance: { kind: "absolute", value: 0 }, candidate_causes: [] },
    { metric: "ok", split: "val", reported_value: 0, reproduced_value: 0, status: "match", tolerance: { kind: "absolute", value: 0 }, candidate_causes: [] },
  ] });
  const p = await renderPage(<ExperimentRunPage />, "/experiments/tasks/:taskId", "/experiments/tasks/t");
  try {
    await p.flush(); await p.click("Compare run r");
    await p.fill("r-metric-0", "score"); await p.fill("r-split-0", "val");
    await p.fill("r-evidence-0", "e1"); await p.fill("r-tolerance-0", "0.01");
    await p.fill("r-params", '[{"name":"batch","evidence_id":"e2","number_index":0}]');
    await p.click("Compare");
    expect(post).toHaveBeenCalledWith("/runs/r/compare", { items: [{ metric: "score", split: "val", evidence_id: "e1", number_index: 0, unit: null, tolerance: { kind: "absolute", value: 0.01 } }], paper_params: [{ name: "batch", evidence_id: "e2", number_index: 0 }] }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    expect(p.host.textContent).toContain("Out of tolerance"); expect(p.host.textContent).toContain("Within tolerance");
    expect(p.host.textContent).toContain("Not comparable"); expect(p.host.textContent).toContain("evidence stale");
    expect(p.host.textContent).toContain("candidate cause"); expect(p.host.textContent).toContain("32");
    await p.fill("r-params", "{}"); await p.click("Compare");
    expect(post).toHaveBeenCalledTimes(1); expect(p.host.textContent).toContain("JSON array");
  } finally { await p.dispose(); }
});

it("supports multiple mappings, relative tolerance, pending protection and retry after a server error", async () => {
  vi.spyOn(api, "get").mockImplementation(p => Promise.resolve(p === "/tasks/t" ? { id: "t" } : p.endsWith("/runs") ? [{ id: "r" }] : { id: "r", metrics: [], signals: [] }));
  let reject!: (error: Error) => void;
  const post = vi.spyOn(api, "post").mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const p = await renderPage(<ExperimentRunPage />, "/experiments/tasks/:taskId", "/experiments/tasks/t");
  try {
    await p.flush(); await p.click("Compare run r"); await p.click("Add mapping");
    for (const i of [0, 1]) {
      await p.fill(`r-metric-${i}`, `score${i}`); await p.fill(`r-split-${i}`, "val");
      await p.fill(`r-evidence-${i}`, `e${i}`);
    }
    await act(async () => {
      const select = p.host.querySelector("select");
      if (!select) throw new Error("Missing tolerance kind");
      select.value = "relative"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await p.click("Compare");
    expect(post.mock.calls[0]?.[1]).toMatchObject({ items: [{ tolerance: { kind: "relative" } }, { metric: "score1" }] });
    expect(p.host.querySelector("fieldset")?.disabled).toBe(true);
    await act(async () => reject(new Error("Comparison unavailable"))); await p.flush();
    expect(p.host.textContent).toContain("Comparison unavailable");
    expect(p.host.querySelector("fieldset")?.disabled).toBe(false);
    await p.click("Remove mapping 2");
    post.mockResolvedValue({ run_id: "r", items: [] }); await p.click("Compare");
    expect(p.host.textContent).toContain("No comparison items returned");
    await p.fill("r-evidence-0", "new-evidence");
    expect(p.host.textContent).not.toContain("No comparison items returned");
  } finally { await p.dispose(); }
});

it("exports run slides in one click and links the file for download", async () => {
  vi.spyOn(api, "get").mockImplementation(p => Promise.resolve(p === "/tasks/t" ? { id: "t", state: "succeeded" } : p.endsWith("/runs") ? [{ id: "r" }] : { id: "r", metrics: [], signals: [] }));
  const post = vi.spyOn(api, "post").mockResolvedValue({ id: "exp1", status: "ok", files: [{ path: "exports/r-report_slides-exp1/report.pptx", mime: "pptx", sha256: "x" }], diagnostics: [{ severity: "info", code: "empty_section", message: "Background: no content", ref: "Background" }] });
  const p = await renderPage(<ExperimentRunPage />, "/experiments/tasks/:taskId", "/experiments/tasks/t");
  try {
    await p.flush(); await p.click("Export slides");
    expect(post).toHaveBeenCalledWith("/exports/report_slides", { run_id: "r", mode: "final", options: { language: "en" } }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    const select = document.getElementById("run-export-language") as HTMLSelectElement;  // ADR-234: English by default
    await act(async () => { select.value = "zh-CN"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.click("Export slides");
    expect(post).toHaveBeenLastCalledWith("/exports/report_slides", { run_id: "r", mode: "final", options: { language: "zh-CN" } }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    const link = p.host.querySelector("a[download]");
    expect(link?.getAttribute("href")).toBe("/api/v1/exports/exp1/files/report.pptx");
    expect(p.host.textContent).toContain("empty_section");
  } finally { await p.dispose(); }
});
it("shows the run's figures from the hash-checked figure route", async () => {
  vi.spyOn(api, "get").mockImplementation((p) => Promise.resolve(p === "/tasks/t" ? { id: "t", state: "succeeded" }
    : p === "/tasks/t/runs" ? [{ id: "r", attempt: 1, state: "succeeded" }]
    : { id: "r", attempt: 1, state: "succeeded", task_state: "succeeded", error_message: null, metrics: [], signals: [],
        artifacts: [{ path: "runs/r/host_figures/confusion_search_val.png", sha256: "h", size: 10, kind: "figure" },
                    { path: "runs/r/run.json", sha256: "h2", size: 10, kind: "manifest" }] }));
  const p = await renderPage(<ExperimentRunPage />, "/experiments/tasks/:taskId", "/experiments/tasks/t");
  try { await p.flush();
    const imgs = [...document.querySelectorAll("img")].map(i => i.getAttribute("src")).filter(s => s?.startsWith("/api/"));
    expect(imgs).toEqual(["/api/v1/runs/r/figures/confusion_search_val.png"]);
  } finally { await p.dispose(); }
});
