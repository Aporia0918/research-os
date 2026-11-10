"""Re-check page citations: is the whole quoted text on the cited PDF page? (NFKC, whitespace and line-break
hyphens ignored). Usage: python scripts/citation_check.py <pdf> <json>... ; prints a Markdown table."""
import json, re, subprocess, sys, unicodedata

def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"-\s*\n\s*", "", s)  # "move-\nments" -> "movements"
    return re.sub(r"\s+", "", s)

pdf, files = sys.argv[1], sys.argv[2:]
cites = []
for f in files:
    d = json.load(open(f))
    if isinstance(d, list):  # compare-cases.json
        cites += [(f"compare '{c['log']}'", i["citation"]) for c in d for i in c["items"] if i.get("citation")]
    elif "passages" in d:
        cites += [(f"Q&A {p.get('label', 'E%d' % (n + 1))}", {"page_number": p["page_index"] + 1, "quote": p.get("text") or p.get("quote")})
                  for n, p in enumerate(d["passages"])]
    else:
        cites += [(f"compare {i['parameter']}", i["citation"]) for i in d["items"] if i.get("citation")]
ok = 0
print("| 来源 | 页 | 引用文字(前70字) | 整段在该页 |\n|---|---|---|---|")
for src, c in cites:
    page = subprocess.run(["pdftotext", "-f", str(c["page_number"]), "-l", str(c["page_number"]), pdf, "-"],
                          capture_output=True, text=True).stdout
    hit = norm(c["quote"]) in norm(page)
    ok += hit
    print(f"| {src} | p.{c['page_number']} | {c['quote'][:70].replace(chr(10), ' ')} | {'是' if hit else '否'} |")
print(f"\n合计: {ok}/{len(cites)}")
