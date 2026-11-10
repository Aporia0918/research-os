"""Run the 需求调研 hard sentence file once through citation-check. No scoring (answer key held by 需求调研).
usage: python scripts/hard-test-run.py <backend> <state.json> <sentences.json> <pdfdir> <out-dir>
pdfdir must hold eegnet-arxiv.pdf (1611.08024) and ecg-arxiv.pdf (1707.01836)."""
import json, re, subprocess, sys, time, unicodedata, uuid
from pathlib import Path
import requests

base, state_p, sent_p, pdfdir, out = sys.argv[1], sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4]), Path(sys.argv[5])
PDF = {"1611.08024": ("hard-eegnet", "eegnet-arxiv.pdf"), "1707.01836": ("hard-ecg", "ecg-arxiv.pdf")}
st = json.loads(Path(state_p).read_text())
s = requests.Session(); s.headers["x-researchos-client"] = "android"; s.cookies.set("ros_session", st["cookie"])
H = lambda: {"Idempotency-Key": str(uuid.uuid4())}
def norm(t): return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKC", t).lower())
def on_page(pdf, page, quote):
    t = subprocess.run(["pdftotext", "-f", str(page), "-l", str(page), str(pdf), "-"], capture_output=True, text=True).stdout
    return norm(quote) in norm(t)
def version(key, pdf):
    if key in st["papers"]: return st["papers"][key]["version_id"]
    r = s.post(f"{base}/api/v1/documents/upload", headers=H(), files={"file": (pdf.name, open(pdf, "rb"), "application/pdf")})
    r.raise_for_status(); vid = r.json()["version_id"]
    for _ in range(600):
        ps = s.get(f"{base}/api/v1/documents/{vid}").json().get("parse_state")
        if ps not in ("pending", "parsing", "queued", None): break
        time.sleep(1)
    st["papers"][key] = {"version_id": vid, "parse_state": ps}; Path(state_p).write_text(json.dumps(st))
    print(key, "parse_state", ps); return vid

rows, counts = [], {}
for p in json.loads(sent_p.read_text())["papers"]:
    key, fn = PDF[p["url"].rstrip("/").split("/")[-1]]; pdf = pdfdir / fn; vid = version(key, pdf)
    for typ, field in (("true_paraphrase", "true_paraphrases"), ("fake_claim", "fake_claims")):
        for sent in p[field]:
            r = s.post(f"{base}/api/v1/mobile/guidance/citation-check", headers=H(), json={"version_id": vid, "text": sent})
            r.raise_for_status(); items = r.json()["items"]
            # one input sentence may be split into several claims by the backend; keep them all
            parts = [{"claim": i.get("claim"), "verdict": i["verdict"], "reason": i.get("reason"), "best_candidate": i.get("best"),
                      "page": (i.get("citation") or {}).get("page_number"), "quote": (i.get("citation") or {}).get("quote"),
                      "quote_on_page_pdftotext": on_page(pdf, i["citation"]["page_number"], i["citation"]["quote"]) if i.get("citation") else None}
                     for i in items]
            overall = "found" if parts and all(x["verdict"] == "supported" for x in parts) else "not_found"
            rows.append({"paper": p["name"], "type": typ, "sentence": sent, "verdict": overall, "n_claims": len(parts), "claims": parts})
            c = counts.setdefault(p["name"], {}).setdefault(typ, {"found": 0, "not_found": 0}); c[overall] += 1
out.mkdir(parents=True, exist_ok=True)
(out / "hard-test-results.json").write_text(json.dumps({"counts": counts, "rows": rows}, ensure_ascii=False, indent=1))
md = ["# Hard citation test — raw results (not scored; key held by 需求调研)", "",
      "verdict found = every claim parsed from the sentence was judged supported; otherwise not_found.", ""]
for name, c in counts.items(): md.append(f"- {name}: {json.dumps(c)}")
for k, r in enumerate(rows, 1):
    md += ["", f"## {k}. [{r['type']}] {r['paper'][:40]}", f"- sentence: {r['sentence']}", f"- verdict: **{r['verdict']}** ({r['n_claims']} claim(s))"]
    for x in r["claims"]:
        q = (x["quote"] or "").replace("\n", " ")
        md.append(f"  - {x['verdict']} | p.{x['page']} | on-page={x['quote_on_page_pdftotext']} | \"{q}\" | {x['reason']} | best={x['best_candidate']}")
(out / "hard-test-results.md").write_text("\n".join(md) + "\n")
print(json.dumps(counts, ensure_ascii=False, indent=1))
