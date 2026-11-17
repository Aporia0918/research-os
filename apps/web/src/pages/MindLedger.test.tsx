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
