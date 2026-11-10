"""W4 phone-width (412px) walk of the Guide tab against a live backend through the Vite dev proxy.
usage: w4_phone_walk.py <app-url> <state.json> <confirmed-plan-id> <out-dir>. The session cookie is never printed."""
import json, sys
from playwright.sync_api import sync_playwright

url, state_p, plan_id, out = sys.argv[1:5]
st = json.load(open(state_p)); vid = st["papers"]["eegnet"]["version_id"]
pre = {"settings.backendUrl": url, "paper.last.v1": json.dumps({"versionId": vid, "name": "eegnet.pdf", "parseState": "partial"}),
       "plan.lastConfirmed.v1": plan_id}
log = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
    ctx = b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.add_cookies([{"name": "ros_session", "value": st["cookie"], "url": url}])
    ctx.add_init_script("const p=%s; for (const k in p) localStorage.setItem('CapacitorStorage.'+k, p[k]);" % json.dumps(pre))
    pg = ctx.new_page(); pg.goto(url)
    pg.get_by_role("tab", name="Guide").click()
    pg.get_by_label("guidance input").fill("I want to replicate this on our own 32-channel EEG recordings and compare against a simple baseline.")
    pg.get_by_role("button", name="Check").click(); pg.wait_for_selector("[data-testid=guide-state]")
    pg.screenshot(path=f"{out}/w4-01-questions-draft.png", full_page=True)
    items = pg.locator("[data-testid=guide-item]")
    items.nth(0).get_by_role("button", name="采纳 Adopt").click()
    items.nth(1).get_by_role("button", name="忽略 Ignore").click()
    items.nth(2).get_by_role("button", name="改写 Edit").click()
    items.nth(2).get_by_label("your version").fill("Our montage has 32 channels, not 64: which channels matter?")
    pg.screenshot(path=f"{out}/w4-02-questions-decided.png", full_page=True)
    pg.get_by_role("button", name="Confirm").click(); pg.wait_for_selector("text=已确认")
    pg.screenshot(path=f"{out}/w4-03-questions-confirmed.png", full_page=True)
    log.append({"questions_items": items.count(), "confirm_buttons_after": pg.get_by_role("button", name="Confirm").count()})
    pg.get_by_role("tab", name="引用检查 Citations").click()
    pg.get_by_label("guidance input").fill("Data from the remaining 15 participants were further analyzed. "
                                           "Participants were shown images of natural scenery at 10 Hz rate.")
    pg.get_by_role("button", name="Check").click(); pg.wait_for_selector("[data-testid=guide-state]")
    pg.screenshot(path=f"{out}/w4-04-citation-check.png", full_page=True)
    log.append({"exact_shown": pg.get_by_text("找到原句", exact=True).count(),
                "near_shown": pg.get_by_text("找到相近原文(需你确认)", exact=True).count(),
                "cannot_check_shown": pg.get_by_text("无法核对(规则模式不支持意译,不等于没有依据)", exact=True).count()})
    pg.get_by_role("tab", name="方法检查 Methods").click()
    pg.get_by_label("guidance input").fill("Models were trained and tested in a Tensorflow environment on an NVIDIA GTX 1080 Ti GPU.")
    pg.get_by_role("button", name="Check").click(); pg.wait_for_selector("[data-testid=guide-state]")
    pg.locator("[data-testid=guide-item]").nth(0).get_by_role("button", name="已处理 Handled").click()
    pg.locator("[data-testid=guide-item]").nth(1).get_by_role("button", name="不适用 N/A").click()
    pg.screenshot(path=f"{out}/w4-05-methods-check.png", full_page=True)
    pg.get_by_role("button", name="Confirm").click(); pg.wait_for_selector("text=已确认")
    pg.screenshot(path=f"{out}/w4-06-methods-confirmed.png", full_page=True)
    log.append({"missing_shown": pg.locator("text=方法段落里没写到").count()})
    b.close()
json.dump(log, open(f"{out}/w4-phone-walk.json", "w"), ensure_ascii=False, indent=1); print(log)
