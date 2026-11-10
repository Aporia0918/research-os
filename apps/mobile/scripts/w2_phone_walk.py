"""Phone-width walk of Ask / Log / Settings against the live backend (via the Vite dev proxy).
Usage: python scripts/w2_phone_walk.py <pairing-json> <pdf> <out-dir>. The pairing code is never printed."""
import json, sys
from playwright.sync_api import sync_playwright

pair, pdf, out = sys.argv[1], sys.argv[2], sys.argv[3]
code = json.load(open(pair))["code"]
log = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
    pg = b.new_page(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg.goto("http://localhost:5173/")
    pg.get_by_role("tab", name="Settings").click()
    pg.locator("input").first.fill("http://localhost:5173")
    pg.get_by_role("button", name="Test connection").click()
    pg.wait_for_selector("text=Connected")
    pg.locator("input").nth(1).fill(code)
    pg.get_by_role("button", name="Pair this phone").click()
    pg.wait_for_selector("text=Paired")
    pg.locator("input").nth(1).fill("")  # keep the code out of the screenshot
    pg.screenshot(path=f"{out}/01-settings-paired.png", full_page=True); log.append("settings: connected + paired")
    pg.get_by_role("tab", name="Ask").click()
    with pg.expect_file_chooser() as fc:
        pg.get_by_role("button", name="Import PDF").click()
    fc.value.set_files(pdf)
    try:
        pg.wait_for_selector("text=Ready", timeout=60000)
    except Exception:
        pg.screenshot(path=f"{out}/fail-import.png", full_page=True)
        print("IMPORT FAILED:", pg.locator(".card").all_inner_texts())
        raise
    pg.screenshot(path=f"{out}/02-ask-imported.png", full_page=True); log.append("ask: imported " + pg.get_by_test_id("paper").inner_text())
    pg.locator("textarea").fill("How was the EEG band-pass filtered?")
    pg.get_by_role("button", name="Ask").click()
    pg.wait_for_selector("[data-testid=answer]", timeout=120000)
    pg.screenshot(path=f"{out}/03-ask-answer-pages.png", full_page=True)
    log.append("ask: " + pg.get_by_test_id("answer").inner_text()[:300].replace("\n", " | "))
    pg.get_by_role("tab", name="Log").click()
    pg.locator("textarea").fill("Band-pass 0.5-40 Hz, sampled at 500 Hz, downsampled to 128 Hz.")
    pg.get_by_role("button", name="Save text").click()
    pg.get_by_role("button", name="Sync").click()
    pg.wait_for_selector("text=Synced 1")
    pg.get_by_role("button", name="Compare with paper").first.click()
    pg.wait_for_selector("[data-testid=compare]", timeout=60000)
    pg.get_by_role("button", name="Accept").first.click()
    pg.get_by_role("button", name="Edit").nth(1).click()
    pg.screenshot(path=f"{out}/04-log-compare-feedback.png", full_page=True)
    log.append("log: " + pg.get_by_test_id("compare").inner_text()[:500].replace("\n", " | "))
    pg.reload(); pg.get_by_role("tab", name="Log").click()
    pg.get_by_role("button", name="Compare with paper").first.wait_for()
    log.append("after reload, choice text present: " + str(pg.locator("text=Your choice").count() > 0))
    pg.screenshot(path=f"{out}/05-log-after-reload-no-saved-choices.png", full_page=True)
    b.close()
open(f"{out}/phone-walk-log.txt", "w").write("\n".join(log) + "\n")
print("\n".join(log))
