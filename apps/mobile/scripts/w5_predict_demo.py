"""W5 end-to-end demo of 'prediction and adjustment suggestions' against a local backend.
Public paper (EEGNet, arXiv 1611.08024) + 3 SAMPLE/DEMO log entries (made up for the demo, not real experiment data).
usage: w5_predict_demo.py <backend> <state.json> <pdfdir> <outdir>. The session cookie is never printed."""
import json, re, subprocess, sys, unicodedata, uuid
from pathlib import Path
import requests

base, state_p, pdfdir, out = sys.argv[1], sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4])
out.mkdir(parents=True, exist_ok=True)
st = json.loads(Path(state_p).read_text())
s = requests.Session(); s.headers["x-researchos-client"] = "android"; s.cookies.set("ros_session", st["cookie"])
H = lambda: {"Idempotency-Key": str(uuid.uuid4())}
vid = st["papers"]["eegnet"]["version_id"]
def norm(t): return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKC", t).replace("-\n", "").lower())
def on_page(page, quote):
    t = subprocess.run(["pdftotext", "-f", str(page), "-l", str(page), str(pdfdir / "eegnet.pdf"), "-"], capture_output=True, text=True).stdout
    return norm(quote) in norm(t)
def post(path, body, code=201):
    r = s.post(f"{base}/api/v1/mobile/{path}", headers=H(), json=body); assert r.status_code == code, r.text; return r.json()

pl = post("plans", {"version_id": vid, "use_model": False})
early = s.post(f"{base}/api/v1/mobile/guidance/predict", headers=H(), json={"plan_id": pl["id"], "log_ids": ["x"]})
s.post(f"{base}/api/v1/mobile/plans/{pl['id']}/confirm", headers=H()).raise_for_status()
LOGS = ["[SAMPLE/DEMO DATA] P300 session: band-pass filtered 0.5-30 Hz, downsampled to 128 Hz.",
        "[SAMPLE/DEMO DATA] Recorded at 256 Hz with a 32-channel cap.",
        "[SAMPLE/DEMO DATA] Trials epoched 0-1 s after stimulus onset."]
ids = []
for t in LOGS:
    r = s.post(f"{base}/api/v1/mobile/logs", headers=H(), data={"text": t, "kind": "text", "client_id": uuid.uuid4().hex})
    r.raise_for_status(); ids.append(r.json()["id"])
g = post("guidance/predict", {"plan_id": pl["id"], "log_ids": ids})
for it in g["items"]:
    it["pdftotext_on_page"] = on_page(it["citation"]["page_number"], it["citation"]["quote"])
url = f"{base}/api/v1/mobile/guidance/{g['id']}"
s.put(f"{url}/decisions", headers=H(), json={"decisions": [{"id": g["items"][0]["id"], "decision": "adopt"}]}).raise_for_status()
c = s.post(f"{url}/confirm", headers=H()).json()
late = s.put(f"{url}/decisions", headers=H(), json={"decisions": [{"id": g["items"][0]["id"], "decision": "ignore"}]})
summary = {"plan_items": len(pl["items"]), "predict_before_plan_confirm": [early.status_code, early.json().get("code")],
           "sample_logs": LOGS, "items": len(g["items"]), "by_kind": {k: sum(i["kind"] == k for i in g["items"]) for k in ("adjust", "not_recorded", "consistent")},
           "uncited": sum(not i["citation"] for i in g["items"]), "quote_on_cited_page_pdftotext_nfkc": sum(i["pdftotext_on_page"] for i in g["items"]),
           "confirmed_at": c["confirmed_at"], "decide_after_confirm": [late.status_code, late.json().get("code")],
           "suggestions": [{"kind": i["kind"], "suggestion": i["suggestion"], "prediction": i["prediction"], "page": i["citation"]["page_number"],
                            "quote": i["citation"]["quote"][:200]} for i in g["items"]]}
(out / "predict-demo.json").write_text(json.dumps({"summary": summary, "guidance": g}, ensure_ascii=False, indent=1))
print(json.dumps(summary, ensure_ascii=False, indent=1)); Path("/tmp/w5live/plan_id").write_text(pl["id"])
