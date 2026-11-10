"""ZH walk at 412px, 非真机. Two contexts: locale en-US and default. Every tab, demo, error case, empty state.
Reports visible English outside paper quotes. usage: zh_walk.py <app-url> <state.json> <out-dir>. Cookie never printed."""
import json, re, sys, os
from playwright.sync_api import sync_playwright

url, state_p, out = sys.argv[1:4]
st = json.load(open(state_p)); vid = st["papers"]["eegnet"]["version_id"]
ALLOW = {"Research","OS","EEGNet","EEG","PDF","App","Hz","Adam","epoch","Android","HTTP","ERP","OK","arXiv","Lawhern","http","https","localhost"}
JS = """() => { const c = document.body.cloneNode(true);
  c.querySelectorAll('.quote, .cite, [data-paper-text], textarea, input, select, option').forEach(e => e.remove());
  const attrs = [...document.querySelectorAll('[placeholder],[aria-label],[title]')].map(e => [e.getAttribute('placeholder'), e.getAttribute('aria-label'), e.getAttribute('title')].filter(Boolean).join(' '));
  return c.innerText + '\\n' + attrs.join('\\n') + '\\n' + document.title; }"""
report = {}

def scan(pg, name, ctxname, shots):
    pg.wait_for_timeout(700)
    txt = pg.evaluate(JS)
    words = sorted({w for w in re.findall(r"[A-Za-z][A-Za-z_]{2,}", txt) if w not in ALLOW})
    lines = [l.strip() for l in txt.splitlines() if any(w in l for w in words)]
    shots.append(name); pg.screenshot(path=f"{out}/{ctxname}/{len(shots):02d}-{name}.png", full_page=True)
    report[ctxname].append({"page": name, "english_words": words, "lines": lines[:8]})

def tab(pg, n): pg.locator("nav.tabbar").get_by_role("tab", name=n).first.click(); pg.wait_for_timeout(600)

def walk(b, ctxname, locale):
    os.makedirs(f"{out}/{ctxname}", exist_ok=True); report[ctxname] = []; shots = []
    kw = dict(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    if locale: kw["locale"] = locale
    # 1) empty state: no backend session, no paper
    ctx = b.new_context(**kw); pg = ctx.new_page(); pg.goto(url)
    report[ctxname].append({"navigator.language": pg.evaluate("navigator.language")})
    for t in ("提问", "记录", "计划", "指导", "设置"):
        tab(pg, t); scan(pg, f"empty-{t}", ctxname, shots)
    # error case: bad backend URL + test connection
    pg.get_by_label("后端地址").fill("http://127.0.0.1:9"); pg.get_by_role("button", name="测试连接").click(); pg.wait_for_timeout(2500)
    scan(pg, "error-bad-backend", ctxname, shots)
    # error case: not signed in, ask a question against real backend
    pg.get_by_label("后端地址").fill(url); tab(pg, "提问")
    pg.get_by_label("问题").fill("EEG 是怎么预处理的?"); pg.get_by_role("button", name="提问").last.click(); pg.wait_for_timeout(3000)
    scan(pg, "error-not-signed-in", ctxname, shots)
    # demo mode
    tab(pg, "设置"); pg.get_by_label("演示模式").check(); pg.wait_for_timeout(800); scan(pg, "demo-设置", ctxname, shots)
    for t in ("提问", "记录", "计划", "指导"):
        tab(pg, t)
        for bn in ("提问", "生成计划", "与论文对照"):
            bt = pg.get_by_role("button", name=bn)
            if bt.count() and bt.last.is_enabled():
                try: bt.last.click(timeout=2000); pg.wait_for_timeout(1000)
                except Exception: pass
        scan(pg, f"demo-{t}", ctxname, shots)
    ctx.close()
    # 2) signed in with the imported paper
    ctx = b.new_context(**kw)
    ctx.add_cookies([{"name": "ros_session", "value": st["cookie"], "url": url}])
    pre = {"settings.backendUrl": url, "paper.last.v1": json.dumps({"versionId": vid, "name": "eegnet.pdf", "parseState": "partial"})}
    ctx.add_init_script("const p=%s; if(!sessionStorage.getItem('seeded')){for (const k in p) localStorage.setItem('CapacitorStorage.'+k, p[k]); sessionStorage.setItem('seeded','1');}" % json.dumps(pre))
    pg = ctx.new_page(); pg.goto(url)
    tab(pg, "提问"); pg.get_by_label("问题").fill("EEG 是怎么预处理的?"); pg.get_by_role("button", name="提问").last.click(); pg.wait_for_timeout(8000)
    scan(pg, "live-提问-answer", ctxname, shots)
    tab(pg, "记录"); pg.get_by_label("记录内容").fill("带通滤波 0.5-40 Hz,降采样到 128 Hz"); pg.get_by_role("button", name="保存文字").click()
    pg.get_by_role("button", name="同步").click(); pg.wait_for_timeout(2500)
    bt = pg.get_by_role("button", name="与论文对照")
    if bt.count(): bt.first.click(); pg.wait_for_timeout(5000)
    scan(pg, "live-记录-compare", ctxname, shots)
    tab(pg, "计划"); pg.get_by_role("button", name="生成计划").click()
    pg.wait_for_selector("[data-testid=plan-state]", timeout=60000); pg.wait_for_timeout(1000)
    scan(pg, "live-计划-generated-keyaction-gate", ctxname, shots)
    items = pg.locator(".plan-item")
    for i in range(items.count()):
        ta = items.nth(i).get_by_label("条目内容")
        if ta.count() and "p." in items.nth(i).inner_text():
            ta.fill(ta.input_value().rstrip() + "(学习率 999.7)"); break
    pg.get_by_role("button", name="确认计划").click(); pg.wait_for_timeout(3000)
    scan(pg, "live-计划-number-gate-blocked", ctxname, shots)
    hc = pg.get_by_test_id("hypothesis-card")
    if hc.count(): hc.first.scroll_into_view_if_needed()
    scan(pg, "live-计划-hypothesis-card", ctxname, shots)
    tab(pg, "指导")
    for m in ("反问", "引用检查", "方法检查", "预测与调整"):
        pg.get_by_role("tab", name=m).click(); pg.wait_for_timeout(500); scan(pg, f"live-指导-{m}", ctxname, shots)
    tab(pg, "设置"); scan(pg, "live-设置", ctxname, shots)
    ctx.close()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
    walk(b, "en-US", "en-US"); walk(b, "default", None); b.close()
json.dump({"label": "非真机", "report": report}, open(f"{out}/zh-walk.json", "w"), ensure_ascii=False, indent=1)
for c, r in report.items():
    for x in r:
        if x.get("english_words"): print(c, x["page"], x["english_words"], x["lines"][:3])
print("pages:", {c: len(r) - 1 for c, r in report.items()})
