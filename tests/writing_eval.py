"""Scoring of the W3 logic check and the W5 reporting checklist against the two synthetic writing fixtures
(tests/fixtures/writing/*_draft.md, answer keys next to them). Both drafts and keys were written by the developers:
the EEG sample was used for tuning; the ECG draft (committed before the port) and the EMG draft (committed after
scoring the unchanged port on the ECG draft) were both written before any rule change - held-out, not independent.

A W3 row counts when every listed sentence (found by a quote) carries the expected flag code; a W5 row counts when
the item is not `met`. False alarms: W3 flags on sentences outside every planted row, and stated W5 items not `met`."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).parent / "fixtures" / "writing"


@dataclass(frozen=True)
class Key:
    w3: dict[str, tuple[str, tuple[str, ...]]]  # row -> (flag code, quotes of the sentences that must carry it)
    w5: dict[str, str]  # row -> reporting item that must not be met
    planted: tuple[str, ...] = ()  # further quotes of planted sentences (contradiction partners): no false alarm
    stated: tuple[str, ...] = field(default=())  # reporting items the draft does state


SAMPLE = Key(
    w3={"F1": ("claim_without_evidence", ("Deep networks clearly outperform",)),
        "F2": ("conclusion_exceeds_results", ("This proves that compact deep networks",)),
        "F3": ("contradiction", ("mu-band power over the contralateral motor cortex decreased",)),
        "F4": ("overstrong_causal_wording", ("Imagining a hand movement causes",)),
        "F5": ("claim_without_evidence", ("12 percentage points over the best prior",)),
        "F9": ("conclusion_exceeds_results", ("will eliminate the need", "Clinicians will certainly adopt"))},
    w5={"F6a": "subject_wise_split", "F6b": "leakage", "F7": "power", "F8": "power"},
    planted=("causes a strong increase of mu-band power",),
    stated=("sample_size", "statistics"),
)
HELDOUT = Key(
    w3={"H1": ("claim_without_evidence", ("more reliable than cardiologists",)),
        "H2": ("conclusion_exceeds_results", ("universally detects arrhythmias",)),
        "H3": ("contradiction", ("Shortening the input window to 0.5 s raised",)),
        "H4": ("overstrong_causal_wording", ("Reduced heart rate variability leads to",)),
        "H5": ("claim_without_evidence", ("9 percentage points higher than previously published",)),
        "H9": ("conclusion_exceeds_results", ("Hospitals will soon deploy", "Cardiologists will no longer need"))},
    w5={"H6a": "subject_wise_split", "H6b": "leakage", "H7": "power", "H8": "statistics"},
    planted=("Sensitivity for supraventricular ectopic beats dropped",),
    stated=("sample_size", "ethics"),
)
HELDOUT2 = Key(
    w3={"G1": ("claim_without_evidence", ("most practical input modality",)),
        "G2": ("conclusion_exceeds_results", ("works reliably for all amputees",)),
        "G3": ("contradiction", ("Shifting the electrodes by 1 cm",)),
        "G4": ("overstrong_causal_wording", ("Muscle fatigue drives",)),
        "G5": ("claim_without_evidence", ("exceeds the best results reported in earlier studies",)),
        "G9": ("conclusion_exceeds_results", ("will never again need", "will become the standard controller"))},
    w5={"G6a": "subject_wise_split", "G6b": "leakage", "G7": "power", "G8": "ethics"},
    planted=("Accuracy fell when the electrodes were shifted",),
    stated=("sample_size",),
)
DRAFTS = (("sample_eeg_draft.md", SAMPLE), ("heldout_ecg_draft.md", HELDOUT), ("heldout2_emg_draft.md", HELDOUT2))


def _locate(paras: list[dict[str, Any]], quote: str) -> tuple[int, int]:
    hits = [(p["index"], s["index"]) for p in paras for s in p["sentences"] if quote in s["text"]]
    assert len(hits) == 1, f"quote {quote!r} matches {len(hits)} sentences"
    return hits[0]


def score(name: str, key: Key) -> dict[str, Any]:
    from researchos.services.writing import logic_check, reporting_checklist

    body = (FIXTURES / name).read_text(encoding="utf-8")
    res = logic_check.analyse(body)
    paras = res["paragraphs"]
    codes: dict[tuple[int, int], set[str]] = {}
    for f in res["flags"]:
        codes.setdefault((f["paragraph"], f["sentence"]), set()).add(f["code"].removeprefix("writing."))
    hits = {row: all(code in codes.get(_locate(paras, q), set()) for q in quotes)
            for row, (code, quotes) in key.w3.items()}
    items = {i["key"]: i["status"] for i in reporting_checklist.evaluate(logic_check.paragraphs(body))["items"]}
    hits |= {row: items.get(item, "missing") != "met" for row, item in key.w5.items()}
    planted = {_locate(paras, q) for _, quotes in key.w3.values() for q in quotes}
    planted |= {_locate(paras, q) for q in key.planted}
    alarms = sorted(loc for loc in codes if loc not in planted)
    alarms_w5 = [k for k in key.stated if items.get(k) != "met"]
    return {"detected": sum(hits.values()), "rows": len(hits), "hits": dict(sorted(hits.items())),
            "false_alarms": len(alarms) + len(alarms_w5), "w3_false_alarms": alarms, "w5_false_alarms": alarms_w5,
            "flags": {loc: sorted(c) for loc, c in sorted(codes.items())}}


def main() -> None:
    for name, key in DRAFTS:
        r = score(name, key)
        print(f"{name}: {r['detected']}/{r['rows']} detected, {r['false_alarms']} false alarms")
        print("  missed:", [k for k, v in r["hits"].items() if not v] or "none")
        print("  w3 false alarms (paragraph, sentence):", r["w3_false_alarms"], "w5:", r["w5_false_alarms"])


if __name__ == "__main__":
    main()
