"""Standalone loop walk at 412px, 非真机 (desktop Chrome, web build; native HTTP/installer not exercised).
Local mock model server + local update server only; fake key; no real model. usage: standalone_walk.py <app-url> <out-dir>"""
import json, sys, threading, hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

url, out = sys.argv[1:3]
FAKE = "test-fake-key-000"
APK = b"PK fake apk for walk only " * 50
seen = []
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def send(self, code, body, ct="application/json"):
        self.send_response(code); self.cors(); self.send_header("Content-Type", ct); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        seen.append(("GET", self.path))
        port = self.server.server_address[1]
        if self.path == "/version.json":
            return self.send(200, json.dumps({"versionName": "0.2.0", "versionCode": 2, "minSupportedVersionCode": 1,
                "apk": [{"url": f"http://127.0.0.1:{port}/a.apk", "priority": 1}], "sha256": "0" * 64, "size": len(APK),
                "releaseNotes": "新增:不用电脑也能读 PDF。\n修复若干问题。", "publishedAt": "2026-11-20T12:00:00+08:00", "channel": "stable"}).encode())
        if self.path == "/a.apk": return self.send(200, APK, "application/octet-stream")  # sha deliberately wrong
        self.send(404, b"{}")
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
        ok = self.headers.get("Authorization") == f"Bearer {FAKE}"
        seen.append(("POST", self.path, ok))
        if not ok: return self.send(401, b"{}")
        self.send(200, json.dumps({"choices": [{"message": {"content": "作者用 Adam 训练 EEGNet,学习率 0.001 [p.1]。(本地模拟模型回答)"}}]}).encode())
srv = ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
shots, notes = [], []
def shot(pg, name):
    pg.wait_for_timeout(500); shots.append(name)
    pg.screenshot(path=f"{out}/{len(shots):02d}-{name}.png", full_page=True)
def tab(pg, n): pg.locator("nav.tabbar").get_by_role("tab", name=n).first.click(); pg.wait_for_timeout(400)
def pick(pg, f):
    with pg.expect_file_chooser() as fc: pg.get_by_role("button", name="在手机上读 PDF").click()
    fc.value.set_files(f); pg.wait_for_timeout(1500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2)
    pg = ctx.new_page(); pg.goto(url); pg.wait_for_timeout(800)
    # 1 Settings: model + key (fake) stored on this device only
    tab(pg, "设置")
    pg.get_by_label("模型地址(Base URL)").fill(base + "/v1"); pg.get_by_label("模型名称").fill("mock-model")
    pg.get_by_label("模型密钥").fill(FAKE); pg.get_by_role("button", name="保存在本机").click()
    pg.wait_for_timeout(300)
    notes.append({"key_input_empty_after_save": pg.get_by_label("模型密钥").input_value() == "",
                  "key_text_on_page": FAKE in pg.content()})
    shot(pg, "settings-key-saved-on-phone")
    pg.get_by_role("button", name="测试模型连接").click(); pg.wait_for_timeout(800); shot(pg, "settings-model-test-ok")
    # 2 Ask: text PDF -> answer with pages
    tab(pg, "提问"); pick(pg, "tests/fixtures/pdf/text.pdf"); shot(pg, "ask-text-pdf-read-on-phone")
    pg.get_by_label("问题").fill("What learning rate with Adam?"); pg.get_by_role("button", name="提问").last.click()
    pg.wait_for_selector("[data-testid=local-answer]"); shot(pg, "ask-model-answer-with-pages")
    notes.append({"answer_has_p1": "[p.1]" in pg.inner_text("[data-testid=local-answer]")})
    # 3 Wrong key -> rule mode fallback
    tab(pg, "设置"); pg.get_by_label("模型密钥").fill("wrong-key"); pg.get_by_role("button", name="保存在本机").click()
    tab(pg, "提问"); pick(pg, "tests/fixtures/pdf/text.pdf"); pg.get_by_label("问题").fill("What learning rate with Adam?")
    pg.get_by_role("button", name="提问").last.click(); pg.wait_for_selector("[data-testid=local-answer]"); shot(pg, "ask-rule-fallback-bad-key")
    # 4 Scanned PDF -> honest error
    pick(pg, "tests/fixtures/pdf/scanned.pdf"); shot(pg, "ask-scanned-pdf-error")
    notes.append({"scanned_msg": "扫描件" in pg.content()})
    # 5 Update dialog from local server (bad sha -> not installed)
    tab(pg, "设置"); pg.get_by_label("更新地址").fill(base + "/version.json")
    pg.get_by_role("button", name="检查更新").click(); pg.wait_for_selector("[data-testid=update-dialog]"); shot(pg, "update-dialog")
    pg.get_by_role("button", name="下载并安装").click(); pg.wait_for_timeout(1000); shot(pg, "update-sha-mismatch-not-installed")
    notes.append({"sha_msg": "sha256" in pg.inner_text("[data-testid=update-msg]")})
    # 6 Cold start: reload -> banner from auto check (source now saved)
    pg.reload(); pg.wait_for_timeout(1500); shot(pg, "cold-start-update-banner")
    notes.append({"banner": pg.locator("[data-testid=update-banner]").count() == 1})
    b.close()
srv.shutdown()
rep = {"label": "非真机 · 本地模拟模型/更新源 · 假密钥", "shots": shots, "checks": notes,
       "requests": [s[:2] + (("auth_ok" if s[2] else "auth_rejected"),) if s[0] == "POST" else s for s in seen]}
json.dump(rep, open(f"{out}/walk-report.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(rep["checks"], ensure_ascii=False))
