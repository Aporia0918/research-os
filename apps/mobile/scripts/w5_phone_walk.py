"""W5 phone-width (412px) browser walk of Guide -> 预测与调整 against a live local backend via the Vite dev proxy.
NOT a real phone (非真机). usage: w5_phone_walk.py <app-url> <state.json> <confirmed-plan-id> <out-dir>. Cookie never printed."""
import json, sys
from playwright.sync_api import sync_playwright

url, state_p, plan_id, out = sys.argv[1:5]
st = json.load(open(state_p)); vid = st["papers"]["eegnet"]["version_id"]
pre = {"settings.backendUrl": url, "paper.last.v1": json.dumps({"versionId": vid, "name": "eegnet.pdf", "parseState": "partial"}),
       "plan.lastConfirmed.v1": plan_id}
log = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
    ctx = b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.add_cookies([{"name": "ros_session", "value": st["cookie"], "url": url}])
    ctx.add_init_script("const p=%s; for (const k in p) localStorage.setItem('CapacitorStorage.'+k, p[k]);" % json.dumps(pre))
    pg = ctx.new_page(); pg.goto(url)
    pg.get_by_role("tab", name="Guide").click()
    pg.get_by_role("tab", name="预测与调整 Predict").click()
    pg.wait_for_selector("[data-testid=predict-logs] input[type=checkbox]")
    log["logs_listed"] = pg.locator("[data-testid=predict-logs] input[type=checkbox]").count()
    log["logs_preselected"] = pg.locator("[data-testid=predict-logs] input[type=checkbox]:checked").count()
    pg.screenshot(path=f"{out}/w5-01-predict-pick-logs.png", full_page=True)
    pg.get_by_role("button", name="Check").click(); pg.wait_for_selector("[data-testid=guide-state]")
    pg.screenshot(path=f"{out}/w5-02-predict-draft.png", full_page=True)
    items = pg.locator("[data-testid=guide-item]")
    log["items"] = items.count()
    log["items_with_page"] = sum(1 for k in range(items.count()) if "[p." in items.nth(k).inner_text())
    log["note_shown"] = pg.get_by_test_id("predict-note").inner_text()
    log["first_suggestion"] = items.nth(0).locator("b").inner_text()
    items.nth(0).get_by_role("button", name="采纳 Adopt").click()
    items.nth(1).get_by_role("button", name="忽略 Ignore").click()
    pg.get_by_role("button", name="Confirm").click(); pg.wait_for_selector("text=已确认")
    pg.screenshot(path=f"{out}/w5-03-predict-confirmed.png", full_page=True)
    log["confirm_buttons_after"] = pg.get_by_role("button", name="Confirm").count()
    log["banned_words_on_page"] = [w for w in ("核验", "已核实", "verified") if w in pg.content()]
    b.close()
json.dump(log, open(f"{out}/w5-phone-walk.json", "w"), ensure_ascii=False, indent=1); print(json.dumps(log, ensure_ascii=False, indent=1))
