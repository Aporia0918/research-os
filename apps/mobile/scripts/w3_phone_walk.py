"""Phone-width walk for W3: (1) demo mode fully offline, (2) the Plan screen against a live backend via the Vite
dev proxy. Usage: python scripts/w3_phone_walk.py <app-url> <setup-token-file> <pdf> <out-dir>.
The setup token is read from a file and never printed."""
import json, sys
from playwright.sync_api import sync_playwright

url, tokfile, pdf, out = sys.argv[1:5]
token = open(tokfile).read().split()[-1]
log = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
    ctx = b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True, record_video_dir=f"{out}/video", record_video_size={"width": 412, "height": 915})
    pg = ctx.new_page()
    pg.goto(url)
    # ---- demo mode, network off ----
    ctx.set_offline(True)
    requests = []
    pg.on("request", lambda r: requests.append(r.url))
    pg.get_by_role("tab", name="Settings").click()
    pg.get_by_label("Demo mode").check()
    pg.screenshot(path=f"{out}/demo-01-settings-toggle.png", full_page=True)
    pg.get_by_role("tab", name="Ask").click()
    pg.get_by_role("button", name="Ask").click()
    pg.wait_for_selector("[data-testid=answer]")
    pg.screenshot(path=f"{out}/demo-02-ask-answer.png", full_page=True)
    pg.get_by_role("tab", name="Log").click()
    pg.wait_for_selector("[data-testid=compare]")
    pg.screenshot(path=f"{out}/demo-03-log-compare.png", full_page=True)
    pg.get_by_role("tab", name="Plan").click()
    pg.get_by_role("button", name="Generate plan").click()
    pg.wait_for_selector("[data-testid=plan-state]")
    pg.screenshot(path=f"{out}/demo-04-plan-draft.png")
    pg.get_by_role("button", name="Confirm plan").click()
    pg.wait_for_selector("text=已确认")
    pg.screenshot(path=f"{out}/demo-05-plan-confirmed.png")
    api_calls = [r for r in requests if "/api/" in r]
    log.append({"demo_offline": True, "api_requests_during_demo": api_calls,
                "label_count_on_plan": pg.locator(".demo-banner").count()})
    ctx.set_offline(False)
    pg.get_by_role("tab", name="Settings").click()
    pg.get_by_label("Demo mode").uncheck()
    # ---- live plan ----
    pg.get_by_role("tab", name="Settings").click()
    pg.locator("input:not([type=checkbox])").first.fill(url)
    pg.get_by_role("button", name="Test connection").click()
    pg.wait_for_selector("text=Connected")
    r = pg.request.post(f"{url}/api/v1/auth/setup", headers={"x-researchos-client": "android", "Idempotency-Key": "w3-setup"},
                        data={"username": "w3walk", "password": "w3-" + "x" * 20, "device_name": "w3-walk", "setup_token": token})
    log.append({"setup_status": r.status})
    pg.get_by_role("tab", name="Ask").click()
    with pg.expect_file_chooser() as fc:
        pg.get_by_role("button", name="Import PDF").click()
    fc.value.set_files(pdf)
    pg.wait_for_selector("text=Ready", timeout=120000)
    pg.get_by_role("tab", name="Plan").click()
    pg.get_by_role("button", name="Generate plan").click()
    pg.wait_for_selector("[data-testid=plan-state]", timeout=120000)
    pg.screenshot(path=f"{out}/live-01-plan-draft.png")
    first = pg.get_by_label("item text").first
    first.fill(first.input_value() + " (checked)")
    pg.get_by_role("button", name="Remove").nth(1).click()
    pg.get_by_placeholder("e.g. our amplifier model").fill("Our own amplifier: to be confirmed")
    pg.get_by_role("button", name="Add", exact=True).click()
    pg.screenshot(path=f"{out}/live-02-plan-edited.png", full_page=True)
    pg.get_by_role("button", name="Confirm plan").click()
    pg.wait_for_selector("text=已确认", timeout=60000)
    pg.screenshot(path=f"{out}/live-03-plan-confirmed.png")
    log.append({"live_state": pg.get_by_test_id("plan-state").inner_text()})
    ctx.close()
    b.close()
json.dump(log, open(f"{out}/phone-walk.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(log, ensure_ascii=False))
