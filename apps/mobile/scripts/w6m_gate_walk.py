"""W6M: number-gate UI walk at 412px, 非真机. Edit a cited plan item to carry a wrong number, expect 需确认 block,
then 确认此数值 (confirm_match) and confirm plan. usage: w6m_gate_walk.py <app-url> <state.json> <out-dir>. Cookie never printed."""
import json, sys, traceback
from playwright.sync_api import sync_playwright

url, state_p, out = sys.argv[1:4]
st = json.load(open(state_p)); vid = st["papers"]["eegnet"]["version_id"]
pre = {"settings.backendUrl": url, "paper.last.v1": json.dumps({"versionId": vid, "name": "eegnet.pdf", "parseState": "partial"})}
res = []; ctxd = {}

def step(name, fn, pg):
    try:
        res.append({"step": name, "result": "pass", **(fn(pg) or {})})
    except Exception as e:
        res.append({"step": name, "result": "fail", "error": str(e).splitlines()[0][:400]}); traceback.print_exc()
    pg.screenshot(path=f"{out}/{len(res):02d}-{name}.png", full_page=True)

def s1(pg):
    pg.get_by_role("tab", name="Plan").click()
    pg.get_by_role("button", name="Generate plan").click(); pg.wait_for_selector("[data-testid=plan-state]", timeout=60000)
    pg.wait_for_timeout(800)
    return {"items": pg.locator(".plan-item").count(), "gates_before_edit": pg.get_by_test_id("number-gate").count()}

def s2(pg):
    items = pg.locator(".plan-item"); idx = None
    for i in range(items.count()):
        it = items.nth(i)
        if it.get_by_label("item text").count() and ("p." in it.inner_text() or "引用" in it.inner_text() or "page" in it.inner_text().lower()):
            idx = i; break
    if idx is None: idx = 0
    ta = items.nth(idx).get_by_label("item text")
    old = ta.input_value(); new = old.rstrip() + " (learning rate 999.7)"
    ta.fill(new); ctxd["idx"] = idx
    return {"item_index": idx, "old": old[:150], "new": new[-60:]}

def s3(pg):
    pg.get_by_role("button", name="Confirm plan").click(); pg.wait_for_timeout(3000)
    body = pg.locator("body").inner_text()
    assert "需确认" in body, "no 需确认 shown"
    gates = pg.get_by_test_id("number-gate").count(); assert gates >= 1, "no number-gate box"
    assert "已确认" not in pg.get_by_test_id("plan-state").inner_text(), "plan confirmed despite gate"
    msg = "有数字在引用页找不到原文" in body
    openc = pg.get_by_test_id("number-gate-open").inner_text() if pg.get_by_test_id("number-gate-open").count() else ""
    return {"blocked_msg_shown": msg, "gate_boxes": gates, "open_note": openc, "gate_text": pg.get_by_test_id("number-gate").first.inner_text()[:200]}

def s4(pg):
    n = 0
    while pg.get_by_role("button", name="确认此数值").count() and n < 20:
        pg.get_by_role("button", name="确认此数值").first.click(); pg.wait_for_timeout(1200); n += 1
    return {"confirmed_match": n, "remaining_gate_buttons": pg.get_by_role("button", name="确认此数值").count()}

def s5(pg):
    for _ in range(5):
        b = pg.get_by_role("button", name="批准")
        if not b.count(): break
        b.first.click(); pg.wait_for_timeout(1200)
    pg.get_by_role("button", name="Confirm plan").click()
    try: pg.wait_for_function("document.querySelector('[data-testid=plan-state]').innerText.includes('已确认 Confirmed')", timeout=20000)
    except Exception:
        errs = pg.locator(".card.error, .error, [role=alert]").all_inner_texts()
        raise AssertionError("plan not confirmed; msgs=" + " | ".join(e[:200] for e in errs[:4]))
    return {"plan_state": pg.get_by_test_id("plan-state").inner_text()[:80]}

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
    ctx = b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.add_cookies([{"name": "ros_session", "value": st["cookie"], "url": url}])
    ctx.add_init_script("const p=%s; if(!sessionStorage.getItem('seeded')){for (const k in p) localStorage.setItem('CapacitorStorage.'+k, p[k]); sessionStorage.setItem('seeded','1');}" % json.dumps(pre))
    pg = ctx.new_page(); pg.goto(url)
    for n, f in (("1-generate", s1), ("2-edit-wrong-number", s2), ("3-confirm-blocked", s3), ("4-confirm-match", s4), ("5-plan-confirmed", s5)):
        step(n, f, pg)
    banned = [w for w in ("核验", "已核实", "verified") if w in pg.content()]
    b.close()
json.dump({"label": "非真机", "steps": res, "banned_words_last_page": banned}, open(f"{out}/w6m-gate-walk.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
