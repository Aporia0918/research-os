"""W6 candidate: whole-chain 412px browser walk against the w6-candidate backend via the Vite dev proxy.
非真机 (NOT a real phone, no emulator). usage: w6c_phone_walk.py <app-url> <state.json> <out-dir>. Cookie never printed."""
import json, sys, traceback
from playwright.sync_api import sync_playwright

url, state_p, out = sys.argv[1:4]
st = json.load(open(state_p)); vid = st["papers"]["eegnet"]["version_id"]
pre = {"settings.backendUrl": url, "paper.last.v1": json.dumps({"versionId": vid, "name": "eegnet.pdf", "parseState": "partial"})}
res = []

def step(name, fn, pg):
    try:
        info = fn(pg) or {}
        res.append({"step": name, "result": "pass", **info})
    except Exception as e:  # record the original error text
        res.append({"step": name, "result": "fail", "error": str(e).splitlines()[0][:400]})
        traceback.print_exc()
    pg.screenshot(path=f"{out}/{len(res):02d}-{name}.png", full_page=True)

def s1_import(pg):
    pg.get_by_role("tab", name="Plan").click()
    t = pg.get_by_test_id("plan-paper").inner_text()
    assert "eegnet" in t, t
    return {"paper": t}

def s2_plan(pg):
    pg.get_by_role("button", name="Generate plan").click(); pg.wait_for_selector("[data-testid=plan-state]", timeout=60000)
    pg.get_by_placeholder("e.g. our amplifier model").fill("Ask a cloud model (LLM) to label artifacts")
    pg.get_by_role("button", name="Add").click()
    return {"items": pg.locator(".plan-item").count()}

def s3_keyaction(pg):
    pg.get_by_role("button", name="Confirm plan").click(); pg.wait_for_timeout(2500)
    ka = pg.get_by_test_id("key-action")
    n = ka.count(); assert n >= 1, "no key action shown"
    blocked = pg.locator(".card.error, .card.muted").all_inner_texts()
    for _ in range(n):
        b = pg.get_by_role("button", name="批准")
        if b.count() == 0: break
        b.first.click(); pg.wait_for_timeout(1200)
    ng = 0
    while pg.get_by_role("button", name="确认此数值").count():
        pg.get_by_role("button", name="确认此数值").first.click(); pg.wait_for_timeout(1200); ng += 1
    pg.get_by_role("button", name="Confirm plan").click(); pg.wait_for_selector("text=已确认", timeout=20000)
    return {"key_actions": n, "number_gates_confirmed": ng, "first_confirm_msgs": [x[:120] for x in blocked][:3]}

def s4_log(pg):
    pg.get_by_role("tab", name="Log").click()
    pg.get_by_placeholder("What did you do? e.g. band-pass 0.5–40 Hz").fill("band-pass 1-40 Hz, sampling rate 128 Hz, 64 channels")
    pg.get_by_role("button", name="Save text").click(); pg.wait_for_timeout(800)
    pg.get_by_role("button", name="Sync").click(); pg.wait_for_selector("text=Compare with paper", timeout=20000)
    pg.get_by_role("button", name="Compare with paper").first.click(); pg.wait_for_selector("[data-testid=compare]", timeout=30000)
    return {"compare": pg.get_by_test_id("compare").first.inner_text()[:200]}

def s5_predict(pg):
    pg.get_by_role("tab", name="Guide").click(); pg.get_by_role("tab", name="预测与调整 Predict").click()
    pg.wait_for_selector("[data-testid=predict-logs] input[type=checkbox]", timeout=20000)
    if not pg.locator("[data-testid=predict-logs] input:checked").count():
        pg.locator("[data-testid=predict-logs] input").first.check()
    pg.get_by_role("button", name="Check").click(); pg.wait_for_selector("[data-testid=guide-state]", timeout=30000)
    n = pg.get_by_test_id("guide-item").count()
    if n: pg.get_by_test_id("guide-item").nth(0).get_by_role("button", name="采纳 Adopt").click()
    pg.get_by_role("button", name="Confirm").click(); pg.wait_for_selector("text=已确认", timeout=20000)
    return {"items": n}

def s6_hyp(pg):
    pg.get_by_role("tab", name="Plan").click(); pg.wait_for_selector("[data-testid=hypothesis-card]", timeout=20000)
    card = pg.get_by_test_id("hypothesis-card")
    card.get_by_placeholder("写下你的假设").fill("EEGNet reaches 90% accuracy with 64 channels")
    card.locator("input[type=checkbox]").first.check()
    card.get_by_role("button", name="添加假设").click(); pg.wait_for_selector("text=待验证", timeout=20000)
    card.get_by_role("button", name="与日志对照").first.click(); pg.wait_for_timeout(1500)
    card.get_by_role("button", name="证据不足").first.click(); pg.wait_for_timeout(1500)
    t = card.inner_text(); assert "证据不足" in t
    return {"needs_confirm_shown": "需确认" in t, "card": t[:300]}

def s7_ideaq(pg):
    pg.get_by_role("tab", name="Guide").click(); pg.get_by_role("tab", name="反问 Questions").click()
    pg.get_by_label("guidance input").fill("I want to change the sampling rate and the number of EEG channels")
    pg.get_by_role("button", name="Check").click(); pg.wait_for_selector("[data-testid=guide-state]", timeout=30000)
    q = pg.get_by_test_id("guide-item").count()
    pg.get_by_role("tab", name="引用检查 Citations").click(); pg.get_by_role("tab", name="反问 Questions").click()
    pg.get_by_label("guidance input").fill("my cat likes sunny windows")
    pg.get_by_role("button", name="Check").click(); pg.wait_for_selector("[data-testid=guide-state]", timeout=30000)
    return {"questions_for_related_idea": q, "unrelated_idea_items": pg.get_by_test_id("guide-item").count(),
            "no_idea_note": pg.get_by_test_id("no-idea-questions").count()}

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
    ctx = b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.add_cookies([{"name": "ros_session", "value": st["cookie"], "url": url}])
    ctx.add_init_script("const p=%s; if(!sessionStorage.getItem('seeded')){for (const k in p) localStorage.setItem('CapacitorStorage.'+k, p[k]); sessionStorage.setItem('seeded','1');}" % json.dumps(pre))
    pg = ctx.new_page(); pg.goto(url)
    for n, f in (("1-import", s1_import), ("2-plan", s2_plan), ("3-keyaction-numgate-confirm", s3_keyaction), ("4-log-compare", s4_log),
                 ("5-predict", s5_predict), ("6-hypothesis", s6_hyp), ("7-idea-questions", s7_ideaq)):
        step(n, f, pg)
    banned = [w for w in ("核验", "已核实", "verified") if w in pg.content()]
    b.close()
json.dump({"label": "非真机", "steps": res, "banned_words_last_page": banned}, open(f"{out}/w6c-walk.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
