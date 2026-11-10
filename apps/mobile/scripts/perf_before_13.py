"""BEFORE (1.3 @ 86d253e) on the same public 20-page PDF. 非真机: desktop Chrome, 412px, CPU 4x via CDP.
Network: everything except the app origin is blocked; requests to the computer address are left UNANSWERED
(what a phone sees when the computer is off/asleep on the LAN). usage: perf_before_13.py <app-url> <pdf> <out-dir>"""
import json, sys, time
from playwright.sync_api import sync_playwright
url, pdf, out = sys.argv[1:4]
APP = url.rstrip('/')
seen, held = [], []
def handler(route):
    u = route.request.url
    if u.startswith(APP): return route.continue_()
    seen.append(u.split('?')[0])
    if '10.0.2.2' in u: held.append(route); return   # computer off: never answers
    route.abort('internetdisconnected')
res = {"label": "非真机 · desktop Chrome 412px · CPU 4x (CDP) · network blocked · computer off (requests unanswered)", "app": "1.3 @ 86d253e"}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"])
    ctx = b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2)
    ctx.route("**/*", handler)
    pg = ctx.new_page(); cdp = ctx.new_cdp_session(pg); cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    pg.goto(url); pg.wait_for_selector("nav.tabbar")
    # A: main 导入 PDF button (uploads to the computer)
    with pg.expect_file_chooser() as fc: pg.get_by_role("button", name="导入 PDF").click()
    t0 = time.perf_counter(); fc.value.set_files(pdf)
    pg.wait_for_timeout(3000); pg.screenshot(path=f"{out}/01-main-import-waiting-3s.png", full_page=True)
    done = None
    while time.perf_counter() - t0 < 130:
        txt = pg.inner_text("main")
        if "已就绪" in txt or "连不上" in txt or "没有成功" in txt or "超时" in txt or "出错" in txt: done = txt; break
        pg.wait_for_timeout(1000)
    res["main_import"] = {"elapsed_ms": round((time.perf_counter() - t0) * 1000, 1), "result": "ended with message" if done else "still waiting at 130 s; no page parsed",
                          "computer_requests_held": len(held)}
    pg.screenshot(path=f"{out}/02-main-import-after.png", full_page=True)
    b.close()
    # B: secondary 在手机上读 PDF button (local pdf.js), fresh page
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"])
    ctx = b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2); ctx.route("**/*", handler)
    pg = ctx.new_page(); cdp = ctx.new_cdp_session(pg); cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    pg.goto(url); pg.wait_for_selector("nav.tabbar")
    runs = []
    for i in range(3):
        pg.reload(); pg.wait_for_selector("nav.tabbar")
        with pg.expect_file_chooser() as fc: pg.get_by_role("button", name="在手机上读 PDF").click()
        t0 = time.perf_counter(); fc.value.set_files(pdf)
        pg.wait_for_function("document.body.innerText.includes('已在手机上读好')", timeout=120000)
        runs.append(round((time.perf_counter() - t0) * 1000, 1))
    res["local_read_button_ms"] = runs
    pg.screenshot(path=f"{out}/03-local-read-button.png", full_page=True)
    b.close()
res["blocked_or_held_requests"] = sorted(set(seen))
json.dump(res, open(f"{out}/before.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
