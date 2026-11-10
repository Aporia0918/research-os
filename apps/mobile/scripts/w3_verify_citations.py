"""Check that each drafted plan item's quote appears on its cited PDF page (pdftotext)."""
import json, re, subprocess, sys, unicodedata
from pathlib import Path
# usage: w3_verify_citations.py <pdfdir> [evidence dir with plan-<name>.json] [name ...]   (default: W3, 3 EEG papers)
PDFS = Path(sys.argv[1]); EV = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("evidence/W3")
NAMES = sys.argv[3:] or ["eegnet", "eegtcnet", "schirrmeister2017"]
def norm(s):
    s = unicodedata.normalize("NFKC", s).replace("-\n", "").lower()
    return re.sub(r"[^a-z0-9]+", "", s)
def page(pdf, n):
    return norm(subprocess.run(["pdftotext", "-f", str(n), "-l", str(n), str(pdf), "-"], capture_output=True, text=True).stdout)
out = [f"# citation spot-check ({EV}) (pdftotext, automatic)\n", "Each quote normalised (NFKC, lowercase, letters/digits only) and searched on the cited page. 'other page' = found only on a different page.\n"]
tot = {}
for name in NAMES:
    d = json.load(open(EV / f"plan-{name}.json")); pdf = PDFS / f"{name}.pdf"
    npages = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout).group(1))
    cache = {i: page(pdf, i) for i in range(1, npages + 1)}
    out.append(f"\n## {name} ({len(d['draft']['items'])} items)\n\n| # | category | page | result | text (first 90 chars) |\n|---|---|---|---|---|")
    c = {"on page": 0, "other page": 0, "not found": 0}
    for i, it in enumerate(d["draft"]["items"], 1):
        cit = it["citation"]; q = norm(cit["quote"]); p = cit["page_number"]
        r = "on page" if q in cache[p] else ("other page" if any(q in v for v in cache.values()) else "not found")
        c[r] += 1
        out.append(f"| {i} | {it['category']} | {p} | {r} | {it['text'][:90].replace('|','/')} |")
    tot[name] = c; out.append(f"\nTally: {c}\n")
Path(EV / "citation-check.md").write_text("\n".join(out)); print(json.dumps(tot))
