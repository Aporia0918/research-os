import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import type { FileRoot } from "@/api/types";
import { renderPage } from "@/test/pageHarness";
import { FoldersCard } from "./SettingsFolders";
afterEach(() => { vi.restoreAllMocks(); });

it("lists the folders, adds one as read and removes one by replacing the whole list", async () => {
  const start: FileRoot[] = [{ path: "/data/old", access: "write", cloud_allowed: false }];
  vi.spyOn(api, "get").mockResolvedValue(start);
  const put = vi.spyOn(api, "put").mockImplementation(async (_p: string, body: unknown) => (body as { roots: FileRoot[] }).roots);
  const p = await renderPage(<FoldersCard />, "/", "/");
  try {
    expect(p.host.textContent).toContain("/data/old");
    await p.fill("folder-path", " /data/project ");
    await p.click("Add folder");
    expect(put).toHaveBeenLastCalledWith("/settings/file-roots",
      { roots: [...start, { path: "/data/project", access: "read" }] }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    expect(p.host.textContent).toContain("/data/project");
    const remove = p.host.querySelector('button[aria-label="Remove /data/old"]') as HTMLButtonElement;
    await p.flush(); remove.click(); await p.flush();
    expect(put.mock.calls.at(-1)?.[1]).toEqual({ roots: [{ path: "/data/project", access: "read" }] });
  } finally { await p.dispose(); }
});
