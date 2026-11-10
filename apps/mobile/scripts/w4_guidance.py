"""W4 guidance acceptance run against a local backend (session cookie from state.json; never printed).
usage: w4_guidance.py <backend> <state.json> <pdfdir> <outdir>"""
import json, re, subprocess, sys, unicodedata, uuid
from pathlib import Path
import requests

base, state_p, pdfdir, out = sys.argv[1], sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4])
out.mkdir(parents=True, exist_ok=True)
st = json.loads(Path(state_p).read_text())
s = requests.Session(); s.headers["x-researchos-client"] = "android"; s.cookies.set("ros_session", st["cookie"])
H = lambda: {"Idempotency-Key": str(uuid.uuid4())}
P = {n: st["papers"][n]["version_id"] for n in ("eegnet", "schirrmeister2017", "eegtcnet")}

def norm(t): return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKC", t).replace("-\n", "").lower())
_pc = {}
def on_page(name, page, quote):
    k = (name, page)
    if k not in _pc:
        _pc[k] = norm(subprocess.run(["pdftotext", "-f", str(page), "-l", str(page), str(pdfdir / f"{name}.pdf"), "-"],
                                     capture_output=True, text=True).stdout)
    return norm(quote) in _pc[k]
def post(path, body):
    r = s.post(f"{base}/api/v1/mobile/{path}", headers=H(), json=body); r.raise_for_status(); return r.json()

# 1) research guidance: 3 papers x 2 ideas
IDEAS = ["I want to replicate this on our own 32-channel EEG recordings and compare against a simple baseline.",
         "We plan to train the same model with fewer training trials per subject and a different filter band."]
qres, qcite = [], {"on_page": 0, "total": 0}
for n, vid in P.items():
    for k, idea in enumerate(IDEAS):
        g = post("guidance/questions", {"version_id": vid, "idea": idea, "use_model": False})
        for it in g["items"]:
            ok = on_page(n, it["citation"]["page_number"], it["citation"]["quote"])
            it["pdftotext_on_page"] = ok; qcite["total"] += 1; qcite["on_page"] += ok
        (out / f"questions-{n}-{k+1}.json").write_text(json.dumps({"paper": n, "idea": idea, "guidance": g}, ensure_ascii=False, indent=1))
        qres.append({"paper": n, "idea": k + 1, "id": g["id"], "status": g["status"], "method": g["method"],
                     "questions": len(g["items"]), "uncited": sum(not i["citation"] for i in g["items"])})
# decision + confirm + 409 demo on the first one
g0 = qres[0]["id"]; it = json.loads((out / "questions-eegnet-1.json").read_text())["guidance"]["items"]
url = f"{base}/api/v1/mobile/guidance/{g0}"
dec = [{"id": it[0]["id"], "decision": "adopt"}, {"id": it[1]["id"], "decision": "ignore"},
       {"id": it[2]["id"], "decision": "edit", "text": "Our montage has 32 channels, not 64: which channels matter?"}]
r1 = s.put(f"{url}/decisions", headers=H(), json={"decisions": dec}).status_code
c = s.post(f"{url}/confirm", headers=H()).json()
r2 = s.put(f"{url}/decisions", headers=H(), json={"decisions": [{"id": it[1]["id"], "decision": "adopt"}]})
lock = {"guidance_id": g0, "decide_before_confirm": r1, "state": c["state"], "confirmed_at": c["confirmed_at"],
        "decide_after_confirm": r2.status_code, "code": r2.json().get("code")}

# 2) citation check: 10 correct + 10 wrong
CLAIMS = [  # (paper, claim, expected: page if correct else None)
 ("eegnet", "Continuous EEG data were referenced offline to the average of the left and right earlobes.", 4),
 ("eegnet", "Data from the remaining 15 participants were further analyzed.", 4),
 ("eegnet", "In this study, 13 subjects performed self-paced finger movements.", 5),
 ("eegnet", "Participants were shown images of natural scenery at 2 Hz rate.", 4),
 ("schirrmeister2017", "In our study, we used crops of about 2 seconds as the input.", 15),
 ("schirrmeister2017", "Filtering was done with a causal 3rd order Butterworth filter.", 19),
 ("schirrmeister2017", "This resulted in 625 crops and therefore 625 label predictions per trial.", 15),
 ("eegtcnet", "The sampling rate is kept at 250 Hz, and no additional bandpass filtering is applied.", 4),
 ("eegtcnet", "The models are trained for 750 epochs with an Adam optimizer at a learning rate of 0.001 and a batch size of 64.", 5),
 ("eegtcnet", "Models were trained and tested in a Tensorflow environment on an NVIDIA GTX 1080 Ti GPU.", 5),
 ("eegnet", "Data from the remaining 25 participants were further analyzed.", None),
 ("eegnet", "Participants were shown images of natural scenery at 10 Hz rate.", None),
 ("eegnet", "EEG data were bandpass filtered to 0.5-100 Hz and downsampled to 512 Hz.", None),
 ("eegnet", "EEGNet always outperforms every other model on all datasets.", None),
 ("schirrmeister2017", "In our study, we used crops of about 4 seconds as the input.", None),
 ("schirrmeister2017", "Filtering was done with a non-causal 5th order Chebyshev filter.", None),
 ("schirrmeister2017", "The deep ConvNet was trained on 10000 patients from a hospital database.", None),
 ("eegtcnet", "The models are trained for 1500 epochs with an SGD optimizer at a learning rate of 0.1.", None),
 ("eegtcnet", "Models were trained on a cluster of 8 TPUs in the cloud.", None),
 ("eegtcnet", "The signals were downsampled to 128 Hz and a 4-40 Hz bandpass filter is applied.", None),
]
crows = []
for n, claim, exp in CLAIMS:
    g = post("guidance/citation-check", {"version_id": P[n], "text": claim}); i = g["items"][0]
    page = i["citation"]["page_number"] if i["citation"] else None
    pdf_ok = on_page(n, page, i["citation"]["quote"]) if i["citation"] else None
    good = (i["verdict"] == "supported" and page == exp and pdf_ok) if exp else i["verdict"] == "not_found"
    crows.append({"paper": n, "claim": claim, "truth": "correct" if exp else "wrong", "expected_page": exp,
                  "verdict": i["verdict"], "page": page, "pdftotext_on_page": pdf_ok, "reason": i.get("reason"),
                  "pass": bool(good), "guidance_id": g["id"]})
ctally = {"correct_found_right_page": sum(r["pass"] for r in crows[:10]), "wrong_marked_not_found": sum(r["pass"] for r in crows[10:])}
(out / "citation-check-run.json").write_text(json.dumps({"tally": ctally, "rows": crows}, ensure_ascii=False, indent=1))

# 3) methods check: 3 confirmed plans x 3 deleted items
mrows = []
for n, vid in P.items():
    pl = post("plans", {"version_id": vid, "use_model": False})
    s.post(f"{base}/api/v1/mobile/plans/{pl['id']}/confirm", headers=H()).raise_for_status()
    items = pl["items"][:9]; drop = {items[0]["id"], items[2]["id"], items[4]["id"]}
    para = " ".join(i["citation"]["quote"].replace("\n", " ") for i in items if i["id"] not in drop)[:4000]
    g = post("guidance/methods-check", {"plan_id": pl["id"], "text": para})
    by = {i["plan_item_id"]: i["verdict"] for i in g["items"]}
    kept_wrong = sum(by[i["id"]] == "missing" for i in items if i["id"] not in drop)
    mrows.append({"paper": n, "plan_id": pl["id"], "guidance_id": g["id"], "plan_items_used": len(items),
                  "deleted": [i["text"][:80] for i in items if i["id"] in drop],
                  "deleted_listed_missing": sum(by[d] == "missing" for d in drop),
                  "kept_but_flagged_missing": kept_wrong, "plan_items_beyond_paragraph_missing":
                  sum(v == "missing" for k, v in by.items() if k not in {i["id"] for i in items})})
    (out / f"methods-check-{n}.json").write_text(json.dumps({"paragraph": para, "guidance": g}, ensure_ascii=False, indent=1))
# handled / not applicable + confirm on the first methods check
gm = mrows[0]["guidance_id"]; gi = s.get(f"{base}/api/v1/mobile/guidance/{gm}").json()["items"]
s.put(f"{base}/api/v1/mobile/guidance/{gm}/decisions", headers=H(), json={"decisions": [
    {"id": gi[0]["id"], "decision": "handled"}, {"id": gi[1]["id"], "decision": "not_applicable"}]}).raise_for_status()
mc = s.post(f"{base}/api/v1/mobile/guidance/{gm}/confirm", headers=H()).json()
late = s.put(f"{base}/api/v1/mobile/guidance/{gm}/decisions", headers=H(), json={"decisions": [{"id": gi[2]["id"], "decision": "handled"}]})
summary = {"questions": qres, "question_citations_pdftotext": qcite, "lock_demo_questions": lock,
           "citation_tally": ctally, "methods": mrows,
           "methods_tally": {"deleted_listed_missing": sum(r["deleted_listed_missing"] for r in mrows), "deleted_total": 9},
           "lock_demo_methods": {"state": mc["state"], "confirmed_at": mc["confirmed_at"], "decide_after_confirm": late.status_code}}
(out / "guidance-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
print(json.dumps(summary, ensure_ascii=False, indent=1))
