import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/api/client";
import { renderPage } from "@/test/pageHarness";
import { Pushes } from "./AppShell";
afterEach(() => { vi.restoreAllMocks(); });

it("shows what the phone pushed and marks it seen; asks nothing while offline", async () => {
  const pushes = [{ id: "push_1", kind: "recall", entity_id: "mrec_1", text: "午睡会提高记忆。", created_at: "" },
    { id: "push_2", kind: "used", entity_id: "mind_1", text: "组会幻灯片", created_at: "" }];
  const get = vi.spyOn(api, "get").mockResolvedValue(pushes);
  const post = vi.spyOn(api, "post").mockResolvedValue({ seen: 2 });
  const info = vi.spyOn(toast, "info").mockImplementation(() => "t");
  const off = await renderPage(<Pushes online={false} />, "/", "/");
  await off.dispose();
  expect(get).not.toHaveBeenCalled();
  const p = await renderPage(<Pushes online />, "/", "/");
  try {
    expect(get).toHaveBeenCalledWith("/pushes", expect.anything());
    expect(info.mock.calls.map((c) => c[0])).toEqual(["The phone sent a recall notice: 午睡会提高记忆。",
      "Your note \"组会幻灯片\" uses an AI answer from the ledger; it is now under \"used in\""]);
    expect(post).toHaveBeenCalledWith("/pushes/seen", { ids: ["push_1", "push_2"] }, expect.anything());
  } finally { await p.dispose(); }
});
