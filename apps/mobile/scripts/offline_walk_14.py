"""1.4 offline walk. 非真机: desktop Chrome (web build of the same src), 412px, CPU 4x via CDP.
Network fully blocked: DNS fails for every host except 127.0.0.1, and every request that is not the app origin is
aborted, except requests to the computer address, which are left unanswered (computer off). No model key.
usage: offline_walk_14.py <app-url> <pdf> <out-dir>"""
import json, sys, time
from playwright.sync_api import sync_playwright
url, pdf, out = sys.argv[1:4]
APP = url.rstrip('/')
phase = {"name": "boot"}; reqs = []; held = []; hold_github = {"on": False}
def handler(route):
    u = route.request.url
    if u.startswith(APP): return route.continue_()
    reqs.append({"phase": phase["name"], "url": u.split('?')[0]})
    if '10.0.2.2' in u or (hold_github["on"] and 'github.com' in u): held.append(route); return
    route.abort('internetdisconnected')
shots, R = [], {"label": "非真机 · desktop Chrome 412px · CPU 4x (CDP) · 全部断网 + 电脑关机 · 无模型密钥", "app": "1.4 (versionCode 5)"}
def shot(pg, name):
    pg.wait_for_timeout(300); shots.append(name); pg.screenshot(path=f"{out}/{len(shots):02d}-{name}.png", full_page=True)
def tab(pg, n): pg.locator("nav.tabbar").get_by_role("tab", name=n).first.click(); pg.wait_for_timeout(300)
def btn(pg, n, exact=True): return pg.locator("main").get_by_role("button", name=n, exact=exact)
def ms(t0): return round((time.perf_counter() - t0) * 1000, 1)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"])
    ctx = b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2); ctx.route("**/*", handler)
    pg = ctx.new_page(); cdp = ctx.new_cdp_session(pg); cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    t0 = time.perf_counter(); pg.goto(url); pg.wait_for_selector("nav.tabbar"); R["first_screen_ms"] = ms(t0)
    pg.wait_for_timeout(2500)  # let the background startup update check run (blocked)
    R["first_screen_interactive_during_startup_check"] = btn(pg, "导入 PDF").is_enabled()
    # settings default
    phase["name"] = "settings"; tab(pg, "设置")
    R["computer_toggle_default_checked"] = pg.get_by_label("连接电脑（增强功能）").is_checked()
    R["enhanced_tab_visible_when_off"] = pg.locator("nav.tabbar").get_by_role("tab", name="电脑增强").count() > 0
    shot(pg, "settings-computer-off-by-default")
    # import x3
    phase["name"] = "import"; tab(pg, "提问"); runs = []
    for i in range(3):
        if i: pg.reload(); pg.wait_for_selector("nav.tabbar")
        with pg.expect_file_chooser() as fc: btn(pg, "导入 PDF").click()
        t0 = time.perf_counter(); fc.value.set_files(pdf)
        pg.wait_for_function("document.body.innerText.includes('已在本机读好')", timeout=120000)
        wall = ms(t0); pg.wait_for_timeout(200)
        stages = json.loads(pg.locator("#import-timings").text_content() or "{}")
        runs.append({"wall_ms_from_file_chosen_to_ready": wall, **stages})
    R["import_runs"] = runs
    R["import_buttons_on_ask_page"] = btn(pg, "导入 PDF").count() + pg.locator("main").get_by_role("button", name="在手机上读 PDF").count()
    shot(pg, "import-20page-done-offline")
    # whole-paper question without key; specific question
    phase["name"] = "ask"
    pg.get_by_label("问题").fill("这篇论文讲什么"); btn(pg, "提问").click(); pg.wait_for_selector("[data-testid=local-answer]")
    R["whole_paper_no_key_msg"] = pg.inner_text("[data-testid=local-answer]").split("\n")[1][:60]; shot(pg, "ask-whole-paper-no-key")
    pg.get_by_label("问题").fill("What learning rate and optimizer were used?"); t0 = time.perf_counter(); btn(pg, "提问").click()
    pg.wait_for_function("document.querySelector('[data-testid=local-answer]') && document.querySelector('[data-testid=local-answer]').innerText.includes('p.')")
    R["ask_specific_rules_ms"] = ms(t0); R["ask_specific_passages"] = pg.locator("[data-testid=local-answer] .passage").count(); shot(pg, "ask-specific-rule-passages")
    # log entry
    phase["name"] = "log"; tab(pg, "记录")
    pg.get_by_label("记录内容").fill("Adam learning rate 0.001, minibatch 128, lowpass 30 Hz, sampled at 128 Hz, 30 s windows"); btn(pg, "保存文字").click(); pg.wait_for_timeout(400)
    shot(pg, "log-saved-on-phone")
    # plan
    phase["name"] = "plan"; tab(pg, "计划"); t0 = time.perf_counter(); btn(pg, "生成计划").click(); pg.wait_for_selector("[data-testid=plan-state], [data-testid=plan-no-method]")
    R["plan_generate_ms"] = ms(t0)
    R["plan_categories"] = [h.inner_text() for h in pg.locator("main h2").all()]
    R["plan_key_actions"] = pg.locator("[data-testid=key-action]").count(); R["plan_number_gates"] = pg.locator("[data-testid=number-gate]").count()
    shot(pg, "plan-draft-with-citations")
    # user adds two items: one that sends data out (key action), one with a number that has no paper quote
    pg.get_by_label("新条目类别").select_option("materials"); pg.get_by_label("新条目内容").fill("Upload the raw recordings to cloud storage and share results with the lab")
    btn(pg, "添加").click(); pg.wait_for_timeout(300)
    pg.get_by_label("新条目类别").select_option("variables"); pg.get_by_label("新条目内容").fill("Bandpass 0.5-35 Hz before training")
    btn(pg, "添加").click(); pg.wait_for_timeout(300)
    R["plan_key_actions_after_add"] = pg.locator("[data-testid=key-action]").count(); R["plan_number_gates_after_add"] = pg.locator("[data-testid=number-gate]").count()
    R["plan_confirm_enabled_before_decisions"] = btn(pg, "确认计划").is_enabled()
    shot(pg, "plan-key-action-and-number-need-decision")
    approved = 0
    for i in range(btn(pg, "批准").count()): btn(pg, "批准").nth(i).click(); pg.wait_for_timeout(200); approved += 1
    confirmed_nums = 0
    for _ in range(50):
        if not btn(pg, "确认此数值").count(): break
        btn(pg, "确认此数值").first.click(); pg.wait_for_timeout(150); confirmed_nums += 1
    R["plan_key_actions_approved"] = approved; R["plan_numbers_confirmed"] = confirmed_nums
    shot(pg, "plan-approvals-done")
    btn(pg, "确认计划").click(); pg.wait_for_timeout(500)
    R["plan_confirmed"] = "已确认" in pg.inner_text("[data-testid=plan-state]")
    # hypothesis
    hc = pg.locator("[data-testid=hypothesis-card]")
    hc.get_by_label("假设").fill("Adam with learning rate 0.001 gives stable training on our 30 s windows"); hc.locator("input[type=checkbox]").first.check()
    hc.get_by_role("button", name="添加假设").click(); pg.wait_for_timeout(400)
    hc.get_by_role("button", name="与日志对照").first.click(); pg.wait_for_timeout(400)
    hc.get_by_role("button", name="支持").first.click(); pg.wait_for_timeout(300)
    R["hypothesis_text"] = hc.inner_text()[:400]
    shot(pg, "plan-confirmed-hypothesis-compared")
    # guide
    phase["name"] = "guide"; tab(pg, "指导"); G = {}
    for mode, text in [("反问", "I want to lowpass filter our EEG at 30 Hz, downsample to 128 Hz, split subjects into training and test sets, and train with Adam on 30 s windows."),
                       ("引用检查", "The model was trained with Adam with a learning rate of 0.001.\nSignals were lowpass filtered at 40 Hz."),
                       ("方法检查", "EEG was lowpass filtered at 30 Hz and downsampled to 128 Hz. We used Adam."),
                       ("预测与调整", None)]:
        pg.locator("main").get_by_role("tab", name=mode).click(); pg.wait_for_timeout(400)
        if text: pg.get_by_label("指导输入").fill(text)
        t0 = time.perf_counter(); btn(pg, "检查").click()
        pg.wait_for_selector("[data-testid=guide-state], main .card.error", timeout=30000)
        G[mode] = {"ms": ms(t0), "items": pg.locator("[data-testid=guide-item]").count(),
                   "error": pg.locator("main .card.error").first.inner_text() if pg.locator("main .card.error").count() else ""}
        shot(pg, f"guide-{ {'反问':'questions','引用检查':'citation','方法检查':'methods','预测与调整':'predict'}[mode] }")
    # one guidance approval: decide every item of the last run, then confirm
    for it in pg.locator("[data-testid=guide-item]").all():
        bs = it.get_by_role("button").all()
        if bs: bs[0].click(); pg.wait_for_timeout(100)
    if btn(pg, "确认").count(): btn(pg, "确认").click(); pg.wait_for_timeout(400)
    G["predict_confirmed"] = "已确认" in pg.inner_text("[data-testid=guide-state]")
    shot(pg, "guide-predict-confirmed"); R["guide"] = G
    # enhanced ON: computer off -> 5 s fallback
    phase["name"] = "enhanced"; tab(pg, "设置"); pg.get_by_label("连接电脑（增强功能）").check(); pg.wait_for_timeout(300); shot(pg, "settings-computer-on")
    tab(pg, "电脑增强"); t0 = time.perf_counter(); btn(pg, "获取更多论文线索").click()
    pg.wait_for_selector("[data-testid=enhanced-notice]", timeout=20000); R["enhanced_fallback_ms"] = ms(t0)
    R["enhanced_notice"] = pg.inner_text("[data-testid=enhanced-notice]"); R["enhanced_local_items"] = pg.locator("main .card .card b").count()
    shot(pg, "enhanced-computer-off-fallback-phone")
    tab(pg, "设置"); pg.get_by_label("连接电脑（增强功能）").uncheck(); pg.wait_for_timeout(300)
    # update check: blocked (DNS fails) and hanging (no reply)
    phase["name"] = "update-blocked"; t0 = time.perf_counter(); btn(pg, "检查更新").click()
    pg.wait_for_function("document.querySelector('[data-testid=update-msg]') && !document.querySelector('[data-testid=update-check-progress]')", timeout=20000)
    R["update_blocked"] = {"ms": ms(t0), "msg": pg.inner_text("[data-testid=update-msg]")}; shot(pg, "update-check-offline")
    phase["name"] = "update-hang"; hold_github["on"] = True; pg.wait_for_timeout(31000)  # 30 s manual guard
    t0 = time.perf_counter(); btn(pg, "检查更新").click(); pg.wait_for_timeout(4000)
    R["update_progress_text_at_4s"] = pg.inner_text("[data-testid=update-check-progress]"); shot(pg, "update-check-progress")
    pg.wait_for_function("!document.querySelector('[data-testid=update-check-progress]')", timeout=30000)
    R["update_hang"] = {"ms": ms(t0), "msg": pg.inner_text("[data-testid=update-msg]")}; shot(pg, "update-check-10s-timeout")
    hold_github["on"] = False
    # wording scan in zh and en on every tab
    phase["name"] = "wording"; bad = {}
    for lang in ["English", "中文"]:
        tab(pg, "设置" if lang == "English" else "Settings"); pg.locator("[data-testid=lang-switch]").get_by_role("radio", name=lang).click(); pg.wait_for_timeout(300)
        names = ["Ask", "Log", "Plan", "Guide", "Settings"] if lang == "English" else ["提问", "记录", "计划", "指导", "设置"]
        for n in names:
            tab(pg, n); t = pg.inner_text("body")
            if "后端" in t or "backend" in t.lower(): bad[f"{lang}/{n}"] = True
            if lang == "English" and n == "Ask": shot(pg, "en-ask")
    R["backend_word_on_screen"] = bad
    b.close()
R["non_app_requests"] = reqs; R["shots"] = shots
json.dump(R, open(f"{out}/after.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(R, ensure_ascii=False, indent=1))
