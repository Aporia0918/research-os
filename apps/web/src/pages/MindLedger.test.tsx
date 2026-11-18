import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { marked } from "@/api/ledger";
import { renderPage } from "@/test/pageHarness";
import { MindLedgerPage } from "./MindLedger";
import { THEMES } from "@jelly/theme";
vi.mock("@/components/layout/AppShell", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
afterEach(() => { vi.restoreAllMocks(); });

const recall = { id: "mrec_1", entry_id: "mind_1", claim: "午睡会提高记忆。", paper: "论文乙", page: 3, quote: "午睡会降低记忆。",
  board: "科研", topic: "睡眠", question: "午睡和记忆", answer: "研究很多。午睡会提高记忆。样本不大。", used_in: "组会幻灯片", created_at: "" };
const debts = [
  { id: "a", board: "科研", kind: "citation", topic: "综述", question: "AI 给的引用", weight: "heavy", due_on: "2026-11-17", red: false, used_in: "第二章", source: "app" },
  { id: "b", board: "学习", kind: null, topic: "高数", question: "什么是导数", weight: "light", due_on: "2026-11-17", red: true, used_in: "", source: "app" },
];

it("marks the recalled sentence yellow inside the AI's answer", () => {
  expect(marked(recall.answer, recall.claim)).toEqual(["研究很多。", "午睡会提高记忆。", "样本不大。"]);
  expect(marked("别的", recall.claim)).toEqual(["别的", "", ""]);
});

it("shows the picked board's recalls with the paper's page and where it was used, then its debts; accepting reopens the debt", async () => {
  localStorage.removeItem("ros-board"); // 科研 by default on the computer
  vi.spyOn(api, "get").mockImplementation((p) => Promise.resolve(p === "/mind-ledger/recalls" ? [recall] : debts));
  const post = vi.spyOn(api, "post").mockResolvedValue({ ...recall, state: "accepted" });
  const p = await renderPage(<MindLedgerPage />, "/ledger", "/ledger");
  try {
    expect(p.host.querySelector("mark")?.textContent).toBe("午睡会提高记忆。");
    expect(p.host.textContent).toContain("p.3");
    expect(p.host.textContent).toContain("Used in: 组会幻灯片");
    expect(p.host.textContent).toContain("Citation debt");
    expect(p.host.querySelectorAll("[data-testid=debt]")).toHaveLength(1);
    expect(p.host.querySelector("[data-testid=zhangzhang]")?.getAttribute("data-state")).toBe("research");
    expect(document.documentElement.dataset.board).toBe("科研");
    await p.click("Explain again");
    expect(post).toHaveBeenCalledWith("/mind-ledger/recalls/mrec_1", { state: "accepted" }, expect.objectContaining({ idempotencyKey: "recall:mrec_1:accepted" }));
  } finally { await p.dispose(); }
});

it("marks yellow the paragraphs of the user's notes that use the recalled sentence, with a link to the project", async () => {
  localStorage.removeItem("ros-board");
  const affected = [{ doc_id: "doc_1", project_id: "prj_1", title: "第三章", paragraph: "已有研究表明午睡会提高记忆，所以我们延长了午休。",
    sentence: "已有研究表明午睡会提高记忆，所以我们延长了午休。", score: 0.71 }];
  vi.spyOn(api, "get").mockImplementation((p) => Promise.resolve(p === "/mind-ledger/recalls" ? [{ ...recall, affected }] : debts));
  const p = await renderPage(<MindLedgerPage />, "/ledger", "/ledger");
  try {
    const box = p.host.querySelector("[data-testid=affected]");
    expect(box?.textContent).toContain("1 paragraph of your notes uses this sentence");
    expect(box?.querySelector("mark")?.textContent).toBe(affected[0]?.sentence);
    expect(box?.querySelector("a")?.getAttribute("href")).toBe("/projects/prj_1");
  } finally { await p.dispose(); }
});

it("says so when nothing is due", async () => {
  vi.spyOn(api, "get").mockResolvedValue([]);
  const p = await renderPage(<MindLedgerPage />, "/ledger", "/ledger");
  try { expect(p.host.textContent).toContain("Nothing due today"); } finally { await p.dispose(); }
});

it("the board switch shows that board's debts, moves 账账 and the page colours, and is remembered", async () => {
  localStorage.removeItem("ros-board");
  vi.spyOn(api, "get").mockImplementation((path) => Promise.resolve(path === "/mind-ledger/recalls" ? [recall] : debts));
  const p = await renderPage(<MindLedgerPage />, "/ledger", "/ledger");
  try {
    await p.click("Study");
    expect(p.host.querySelector("mark")).toBeNull(); // the 科研 recall stays on its own board
    expect(p.host.querySelectorAll("[data-testid=debt]")).toHaveLength(1);
    expect(p.host.textContent).toContain("Couldn't explain");
    expect(p.host.querySelector("[data-testid=zhangzhang]")?.getAttribute("data-state")).toBe("dun"); // a red debt is due
    expect(document.documentElement.dataset.board).toBe("学习");
    expect(document.documentElement.style.getPropertyValue("--deep")).toBe(THEMES.学习.deep);
    expect(localStorage.getItem("ros-board")).toBe("学习");
  } finally { await p.dispose(); }
});

it("the mastery report asks for the picked board's day and course, lists what to repay first, and prints to PDF", async () => {
  localStorage.setItem("ros-board", "学习");
  const report = { exam: "2026-12-01", as_of: "2026-11-17", topic: "高数", board: "学习", total: 3,
    counts: { own: 1, settled: 1, shaky: 1, untested: 0 }, independence: 0.667,
    repay_before_exam: [{ id: "b", topic: "高数", question: "什么是导数", weight: "heavy", status: "shaky", attempts: 1, due_on: "2026-11-20" }],
    not_reachable_before_exam: [] };
  const get = vi.spyOn(api, "get").mockImplementation((path) =>
    Promise.resolve(path.startsWith("/mind-ledger/report") ? report : path === "/mind-ledger/recalls" ? [] : debts));
  const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
  const p = await renderPage(<MindLedgerPage />, "/ledger", "/ledger");
  try {
    expect(p.host.textContent).toContain("Pick a day to see the report.");
    await p.fill("report-topic", "高数");
    await p.fill("report-exam", "2026-12-01");
    await p.flush();
    expect(get).toHaveBeenCalledWith("/mind-ledger/report?exam=2026-12-01&board=%E5%AD%A6%E4%B9%A0&topic=%E9%AB%98%E6%95%B0", expect.anything());
    expect(p.host.querySelector("[data-testid=independence]")?.textContent).toBe("67%");
    expect(p.host.querySelectorAll("[data-testid=report-item]")).toHaveLength(1);
    expect(p.host.textContent).toContain("still shaky");
    await p.click("Export PDF");
    expect(print).toHaveBeenCalledOnce();
  } finally { await p.dispose(); }
});
