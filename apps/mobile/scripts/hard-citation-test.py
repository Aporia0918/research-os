"""Harder citation test: sentences NOT chosen by the developers (supplied by 需求调研).
Input JSON: one object or a list of objects
  {"paper": "eegnet", "pdf": "path/to/eegnet.pdf",            # pdf optional if <pdfdir>/<paper>.pdf exists
   "true_paraphrases": [10 strings], "true_pages": [10 ints, optional], "fake_claims": [10 strings]}
usage: python scripts/hard-citation-test.py <backend> <state.json> <pdfdir> <input.json> <out-dir>
- Papers not yet in state.json are uploaded first (needs the same session cookie; never printed).
- hit = a true paraphrase judged "supported" AND the returned quote is on the returned page (pdftotext)
        AND (if true_pages given) the page equals the expected page.
- false alarm = a fake claim judged "supported".
Writes <out-dir>/hard-citation-<paper>.json and hard-citation-summary.json. Does not run without the input file."""
import json, re, subprocess, sys, time, unicodedata, uuid
from pathlib import Path
import requests

base, state_p, pdfdir, inp, out = sys.argv[1], sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4]), Path(sys.argv[5])
out.mkdir(parents=True, exist_ok=True)
st = json.loads(Path(state_p).read_text())
s = requests.Session(); s.headers["x-researchos-client"] = "android"; s.cookies.set("ros_session", st["cookie"])
H = lambda: {"Idempotency-Key": str(uuid.uuid4())}
data = json.loads(inp.read_text()); data = data if isinstance(data, list) else [data]

def norm(t): return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKC", t).replace("-\n", "").lower())
def on_page(pdf, page, quote):
    txt = subprocess.run(["pdftotext", "-f", str(page), "-l", str(page), str(pdf), "-"], capture_output=True, text=True).stdout
    return norm(quote) in norm(txt)
def version(name, pdf):
    if name in st.get("papers", {}): return st["papers"][name]["version_id"]
    r = s.post(f"{base}/api/v1/documents/upload", headers=H(), files={"file": (f"{name}.pdf", open(pdf, "rb"), "application/pdf")})
    r.raise_for_status(); vid = r.json()["version_id"]
    for _ in range(300):
        ps = s.get(f"{base}/api/v1/documents/{vid}").json().get("parse_state")
        if ps not in ("pending", "parsing", "queued", None): break
        time.sleep(1)
    st.setdefault("papers", {})[name] = {"version_id": vid, "parse_state": ps}
    Path(state_p).write_text(json.dumps(st)); return vid
def check(vid, claim):
    r = s.post(f"{base}/api/v1/mobile/guidance/citation-check", headers=H(), json={"version_id": vid, "text": claim})
    r.raise_for_status(); g = r.json()
    if len(g["items"]) != 1:  # the splitter saw several sentences (or none): report, judge on the first
        print(f"warning: {len(g['items'])} claims parsed from: {claim[:60]}", file=sys.stderr)
    return g["items"][0] if g["items"] else {"verdict": "not_found", "citation": None, "reason": "no claim parsed"}

summary = []
for p in data:
    name = p["paper"]; pdf = Path(p.get("pdf") or pdfdir / f"{name}.pdf"); vid = version(name, pdf)
    exp = p.get("true_pages") or [None] * len(p["true_paraphrases"]); rows = []
    for claim, e in zip(p["true_paraphrases"], exp):
        i = check(vid, claim); c = i.get("citation")
        ok_page = bool(c) and on_page(pdf, c["page_number"], c["quote"])
        hit = i["verdict"] == "supported" and ok_page and (e is None or c["page_number"] == e)
        rows.append({"truth": "true", "claim": claim, "verdict": i["verdict"], "page": c and c["page_number"],
                     "expected_page": e, "quote_on_page": ok_page, "reason": i.get("reason"), "hit": hit})
    for claim in p["fake_claims"]:
        i = check(vid, claim); c = i.get("citation")
        rows.append({"truth": "fake", "claim": claim, "verdict": i["verdict"], "page": c and c["page_number"],
                     "quote": c and c["quote"][:200], "reason": i.get("reason"), "false_alarm": i["verdict"] == "supported"})
    nt, nf = len(p["true_paraphrases"]), len(p["fake_claims"])
    res = {"paper": name, "hits": sum(r.get("hit", False) for r in rows), "true_total": nt,
           "false_alarms": sum(r.get("false_alarm", False) for r in rows), "fake_total": nf}
    res["hit_rate"] = round(res["hits"] / nt, 3) if nt else None
    res["false_alarm_rate"] = round(res["false_alarms"] / nf, 3) if nf else None
    (out / f"hard-citation-{name}.json").write_text(json.dumps({"result": res, "rows": rows}, ensure_ascii=False, indent=1))
    summary.append(res); print(res)
(out / "hard-citation-summary.json").write_text(json.dumps(summary, indent=1))
