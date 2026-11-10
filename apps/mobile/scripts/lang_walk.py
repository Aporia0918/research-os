"""Language walk at 412px, 非真机. For each language: switch in Settings, then every tab (empty state, error cases,
demo mode, signed-in live run with Plan gates, hypothesis card, Guide modes, Settings). Browser locale is en-US
throughout, to show the phone language never decides the UI language.
Reports mixed-language text outside paper quotes. usage: lang_walk.py <app-url> <state.json> <out-dir>. Cookie never printed."""
import json, re, sys, os
from playwright.sync_api import sync_playwright

url, state_p, out = sys.argv[1:4]
st = json.load(open(state_p)); vid = st["papers"]["eegnet"]["version_id"]
ALLOW_EN = {"Research","OS","EEGNet","EEG","PDF","App","Hz","Adam","epoch","Android","HTTP","ERP","OK","arXiv","Lawhern","http","https","localhost","English","pdf","eegnet"}
L = {
 "zh": dict(tabs=("提问","记录","计划","指导","设置"), url="后端地址", test="测试连接", q="问题", ask="提问", demo="演示模式",
            buttons=("提问","生成计划","与论文对照"), note="记录内容", save="保存文字", sync="同步", cmp="与论文对照", gen="生成计划",
            item="条目内容", confirm="确认计划", modes=("反问","引用检查","方法检查","预测与调整"), opt="中文",
            question="EEG 是怎么预处理的?", lognote="带通滤波 0.5-40 Hz,降采样到 128 Hz", edit="(学习率 999.7)"),
 "en": dict(tabs=("Ask","Log","Plan","Guide","Settings"), url="Backend URL", test="Test connection", q="Question", ask="Ask", demo="Demo mode",
            buttons=("Ask","Generate plan","Compare with paper"), note="Log note", save="Save text", sync="Sync", cmp="Compare with paper", gen="Generate plan",
            item="Item text", confirm="Confirm plan", modes=("Questions","Citation check","Methods check","Predict & adjust"), opt="English",
            question="How was the EEG preprocessed?", lognote="band-pass 0.5-40 Hz, downsampled to 128 Hz", edit=" (learning rate 999.7)"),
}
JS = """() => { const c = document.body.cloneNode(true);
  c.querySelectorAll('.quote, .cite, [data-paper-text], textarea, input, select, option').forEach(e => e.remove());
  const attrs = [...document.querySelectorAll('[placeholder],[aria-label],[title]')].map(e => [e.getAttribute('placeholder'), e.getAttribute('aria-label'), e.getAttribute('title')].filter(Boolean).join(' '));
  return c.innerText + '\\n' + attrs.join('\\n') + '\\n' + document.title; }"""
report = {}

def scan(pg, name, lang, shots):
    pg.wait_for_timeout(700)
    txt = pg.evaluate(JS)
    if lang == "zh":
        bad = sorted({w for w in re.findall(r"[A-Za-z][A-Za-z_]{2,}", txt) if w not in ALLOW_EN})
    else:
        bad = sorted({w for w in re.findall(r"[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+", txt) if w != "中文"})
    lines = [l.strip() for l in txt.splitlines() if any(w in l for w in bad)]
    shots.append(name); pg.screenshot(path=f"{out}/{lang}/{len(shots):02d}-{name}.png", full_page=True)
    report[lang].append({"page": name, "other_language": bad, "lines": lines[:8], "html_lang": pg.evaluate("document.documentElement.lang")})

def tab(pg, n): pg.locator("nav.tabbar").get_by_role("tab", name=n).first.click(); pg.wait_for_timeout(600)

def switch(pg, lang, t):
    # always start from the default; the first Settings tab name is Chinese
    tab(pg, "设置" if pg.locator("nav.tabbar").get_by_role("tab", name="设置").count() else "Settings")
    pg.get_by_role("radio", name=t["opt"]).click(); pg.wait_for_timeout(500)

def walk(b, lang):
    t = L[lang]; os.makedirs(f"{out}/{lang}", exist_ok=True); report[lang] = []; shots = []
    kw = dict(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="en-US")
    ctx = b.new_context(**kw); pg = ctx.new_page(); pg.goto(url)
    report[lang].append({"navigator.language": pg.evaluate("navigator.language")})
    tab(pg, "设置"); scan(pg, "start-default-设置", lang, shots)   # default is zh even under en-US
    switch(pg, lang, t); scan(pg, f"switched-{t['tabs'][4]}", lang, shots)
    for n in t["tabs"]:
        tab(pg, n); scan(pg, f"empty-{n}", lang, shots)
    pg.get_by_label(t["url"]).fill("http://127.0.0.1:9"); pg.get_by_role("button", name=t["test"]).click(); pg.wait_for_timeout(2500)
    scan(pg, "error-bad-backend", lang, shots)
    pg.get_by_label(t["url"]).fill(url); tab(pg, t["tabs"][0])
    pg.get_by_label(t["q"]).fill(t["question"]); pg.get_by_role("button", name=t["ask"]).last.click(); pg.wait_for_timeout(3000)
    scan(pg, "error-not-signed-in", lang, shots)
    tab(pg, t["tabs"][4]); pg.get_by_label(t["demo"], exact=True).check(); pg.wait_for_timeout(800); scan(pg, f"demo-{t['tabs'][4]}", lang, shots)
    for n in t["tabs"][:4]:
        tab(pg, n)
        for bn in t["buttons"]:
            bt = pg.get_by_role("button", name=bn, exact=True)
            if bt.count() and bt.last.is_enabled():
                try: bt.last.click(timeout=2000); pg.wait_for_timeout(1000)
                except Exception: pass
        scan(pg, f"demo-{n}", lang, shots)
    pg.reload(); pg.wait_for_timeout(1200); tab(pg, t["tabs"][4]); scan(pg, "after-reload-persisted", lang, shots)
    ctx.close()
    ctx = b.new_context(**kw)
    ctx.add_cookies([{"name": "ros_session", "value": st["cookie"], "url": url}])
    pre = {"settings.backendUrl": url, "paper.last.v1": json.dumps({"versionId": vid, "name": "eegnet.pdf", "parseState": "partial"})}
    ctx.add_init_script("const p=%s; if(!sessionStorage.getItem('seeded')){for (const k in p) localStorage.setItem('CapacitorStorage.'+k, p[k]); sessionStorage.setItem('seeded','1');}" % json.dumps(pre))
    pg = ctx.new_page(); pg.goto(url); switch(pg, lang, t)
    tab(pg, t["tabs"][0]); pg.get_by_label(t["q"]).fill(t["question"]); pg.get_by_role("button", name=t["ask"]).last.click(); pg.wait_for_timeout(8000)
    scan(pg, "live-ask-answer", lang, shots)
    tab(pg, t["tabs"][1]); pg.get_by_label(t["note"]).fill(t["lognote"]); pg.get_by_role("button", name=t["save"]).click()
    pg.get_by_role("button", name=t["sync"], exact=True).click(); pg.wait_for_timeout(2500)
    bt = pg.get_by_role("button", name=t["cmp"])
    if bt.count(): bt.first.click(); pg.wait_for_timeout(5000)
    scan(pg, "live-log-compare", lang, shots)
    tab(pg, t["tabs"][2]); pg.get_by_role("button", name=t["gen"]).click()
    pg.wait_for_selector("[data-testid=plan-state]", timeout=60000); pg.wait_for_timeout(1000)
    scan(pg, "live-plan-generated-keyaction-gate", lang, shots)
    items = pg.locator(".plan-item")
    for i in range(items.count()):
        ta = items.nth(i).get_by_label(t["item"])
        if ta.count() and "p." in items.nth(i).inner_text():
            ta.fill(ta.input_value().rstrip() + t["edit"]); break
    pg.get_by_role("button", name=t["confirm"]).click(); pg.wait_for_timeout(3000)
    scan(pg, "live-plan-number-gate-blocked", lang, shots)
    hc = pg.get_by_test_id("hypothesis-card")
    if hc.count(): hc.first.scroll_into_view_if_needed()
    scan(pg, "live-plan-hypothesis-card", lang, shots)
    tab(pg, t["tabs"][3])
    for i, m in enumerate(t["modes"]):
        pg.locator("main").get_by_role("tab", name=m).click(); pg.wait_for_timeout(500); scan(pg, f"live-guide-mode{i+1}", lang, shots)
    tab(pg, t["tabs"][4]); scan(pg, "live-settings", lang, shots)
    ctx.close()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
    walk(b, "zh"); walk(b, "en"); b.close()
json.dump({"label": "非真机 (desktop Chrome, 412px viewport, locale en-US)", "report": report}, open(f"{out}/lang-walk.json", "w"), ensure_ascii=False, indent=1)
for c, r in report.items():
    for x in r:
        if x.get("other_language"): print(c, x["page"], x["other_language"][:12], x["lines"][:3])
print("pages:", {c: len(r) - 1 for c, r in report.items()})
