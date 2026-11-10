"""W4 live driver against a local Research OS backend. Usage:
  python scripts/w4_live.py <backend> <setup-token-file> <state.json> import name=pdf ...
  python scripts/w4_live.py <backend> <setup-token-file> <state.json> plans <out-dir>
The setup token and session cookie are never printed or written to the output dir."""
import json, sys, time, uuid
from pathlib import Path
import requests

base, tokfile, state_p = sys.argv[1:4]
cmd = sys.argv[4]
st = json.loads(Path(state_p).read_text()) if Path(state_p).exists() else {}
s = requests.Session(); s.headers["x-researchos-client"] = "android"
def H(): return {"Idempotency-Key": str(uuid.uuid4())}
if "cookie" in st:
    s.cookies.set("ros_session", st["cookie"])
else:
    r = s.post(f"{base}/api/v1/auth/setup", headers=H(), json={"username": "w4live", "password": str(uuid.uuid4()),
               "device_name": "w4", "setup_token": open(tokfile).read().split()[-1]})
    r.raise_for_status(); st["cookie"] = s.cookies.get("ros_session"); st["papers"] = {}
if cmd == "import":
    for pair in sys.argv[5:]:
        name, path = pair.split("=")
        r = s.post(f"{base}/api/v1/documents/upload", headers=H(), files={"file": (f"{name}.pdf", open(path, "rb"), "application/pdf")})
        r.raise_for_status(); vid = r.json()["version_id"]
        for _ in range(170):
            d = s.get(f"{base}/api/v1/documents/{vid}").json()
            if d.get("parse_state") not in ("pending", "parsing", "queued", None): break
            time.sleep(1)
        st["papers"][name] = {"version_id": vid, "parse_state": d.get("parse_state")}
        print(name, vid, d.get("parse_state"))
elif cmd == "plans":
    out = Path(sys.argv[5]); out.mkdir(parents=True, exist_ok=True); summ = []
    for name, p in st["papers"].items():
        r = s.post(f"{base}/api/v1/mobile/plans", headers=H(), json={"version_id": p["version_id"], "use_model": False})
        r.raise_for_status(); d = r.json()
        (out / f"plan-{name}.json").write_text(json.dumps({"paper": name, "parse_state": p["parse_state"], "draft": d}, ensure_ascii=False, indent=1))
        c = {k: sum(i["category"] == k for i in d["items"]) for k in ("variables", "controls", "materials")}
        summ.append({"paper": name, "status": d.get("status"), "items": len(d["items"]), **c,
                     "uncited": sum(not i["citation"] for i in d["items"])}); print(summ[-1])
    (out / "plan-summary.json").write_text(json.dumps(summ, indent=1))
Path(state_p).write_text(json.dumps(st))
