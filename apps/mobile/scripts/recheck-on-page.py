"""Re-check (no rerun) that every cited / candidate quote in a hard-test JSON is on its page per pdftotext,
normalising with NFKC like the backend (ligatures such as 'ﬁ' -> 'fi'). The v2 harness compared without NFKC.
usage: python scripts/recheck-on-page.py <results.json> <pdfdir>"""
import json, re, subprocess, sys, unicodedata
from pathlib import Path

res, pdfdir = json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2])
arx = {name: v["arxiv"] for name, v in res["meta"]["papers"].items()}
def n(x, nfkc): return re.sub(r"[^a-z0-9]+", "", (unicodedata.normalize("NFKC", x) if nfkc else x).lower())
out = []
for r in res["rows"]:
    for c in r["claims"]:
        if not c.get("original_text"):
            continue
        t = subprocess.run(["pdftotext", "-f", str(c["page"]), "-l", str(c["page"]), str(pdfdir / f"arxiv-{arx[r['paper']]}.pdf"), "-"],
                           capture_output=True, text=True).stdout
        out.append({"type": r["type"], "verdict": c["verdict"], "page": c["page"], "raw": n(c["original_text"], False) in n(t, False),
                    "nfkc": n(c["original_text"], True) in n(t, True)})
print(json.dumps({"checked": len(out), "raw_on_page": sum(o["raw"] for o in out), "nfkc_on_page": sum(o["nfkc"] for o in out),
                  "nfkc_off_page": [o for o in out if not o["nfkc"]]}, indent=1))
