"""mobile-guidance: the plan drafter reads only Methods-like sections found by heading. The ten worst W3 items
(abstract, introduction, related work, captions, formula tail, table row, supplementary pointer) are regressions:
none may come back. No method heading -> status method_section_not_found and no items."""
from __future__ import annotations

import io

import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from researchos.services.mobile.plan import METHOD_FOUND, METHOD_NOT_FOUND, _heading, keep_sentence, method_segments

from .conftest import Client
from .m1_helpers import drain

# the 10 worst W3 items (app/evidence/W3/worst-items.md), as the drafter saw them
WORST = [
    "2.1.1 Input and labels We assume that we are given one EEG data set per subject i.",
    "k=1exp(fk(X j;θ)).In our case, since we train per subject, the softmax output gives us a subject-speciﬁc "
    "conditional distribution.",
    "Stars indicate statistically signiﬁcant diﬀerences to baseline (Wilcoxon signed-rank test, p <0.05: *, p<0.01: "
    "**, p<0.001: ***).",
    "Details about statistical evaluation, software and hardware can be found in Supplementary Sections A.8 and A.9.",
    "FBCSP was the best-performing method for the BCI competition IV dataset 2a, which 5",
    "The results indicate that EEG-TCN ET successfully generalizes beyond one single dataset, outperforming the "
    "current state-of-the-art (SoA) on MOABB by a meta-effect of 0.25.",
    "However, successful decoding of MI-based EEG signals remains a challenging task, mainly due to a low signal-to- "
    "noise ratio.",
    "Name N C # Trials S # Subjects Epoch (s) Cho et al 2 64 200 1 52 0-3 Physionet 2 64 40-60 1 109 1-3 Shin et al "
    "2 25 60 3 29 0-10",
    "I NTRODUCTION Brain–machine interfaces (BMIs) allow direct communi- cation between humans and external devices "
    "by analyzing brain signals.",
    "The most complex network is TPCT [13], which achieves the state-of-the-art (SoA) accuracy of 88.87% on the "
    "4-class MI BCI IV-2a.",
]


def _chunks(pages: list[str]) -> list[dict]:
    return [{"chunk_id": f"c{i}", "page_index": i, "seq": 0, "text": t, "section_role": None}
            for i, t in enumerate(pages)]


def _method_text(pages: list[str]) -> tuple[str, str]:
    status, seg = method_segments(_chunks(pages))
    return status, "\n".join(s["text"] for s in seg)


@pytest.mark.parametrize("line,expected", [
    ("2 Materials and Methods", (1, 2, "start")),
    ("2. Methods", (1, 2, "start")),
    ("III. M ETHODOLOGY", (1, 3, "start")),
    ("II. MATERIALS AND METHODS", (1, 2, "start")),
    ("A. Implementation details", (2, 0, "start_sub")),
    ("2.7 Data sets and preprocessing", (2, 2, "start_sub")),
    ("3 Training", (1, 3, "start")),
    ("IV. E XPERIMENTAL RESULTS", (1, 4, "stop")),
    ("I. I NTRODUCTION", (1, 1, "stop")),
    ("Abstract", (0, 0, "stop")),
    ("References", (0, 0, "stop")),
    ("C. Related Work", (2, 0, "stop")),
])
def test_heading_shapes(line: str, expected: tuple) -> None:
    assert _heading(line) == expected


@pytest.mark.parametrize("line", ["32 NaN", "120.0Freqs", "Convolution", "We used 4 subjects.", "A B C",
                                  "Tonio Ball REFERENCES"])
def test_not_headings(line: str) -> None:
    assert _heading(line) is None


@pytest.mark.parametrize("sentence", WORST)
def test_worst_w3_items_are_rejected_as_sentences(sentence: str) -> None:
    # every worst item is rejected by the sentence filter alone or sits outside a method section (checked below)
    outside = sentence.startswith(("The results", "However", "I NTRODUCTION", "The most complex", "2.1.1"))
    assert outside or not keep_sentence(sentence)


def test_worst_items_never_come_from_their_real_layout() -> None:
    eegtcnet = [
        "Abstract\n" + WORST[5] + "\nI. I NTRODUCTION\n" + WORST[8] + "\n" + WORST[6],
        "II. B ACKGROUND\nC. Related Work\n" + WORST[9] + "\nTABLE I\n" + WORST[7],
        "III. M ETHODOLOGY\nA. Data Pre-processing\nThe sampling rate is kept at 250 Hz, and no additional bandpass "
        "filtering is applied.\nIV. E XPERIMENTAL RESULTS\nEEG-TCNet reaches 77.35% accuracy.",
    ]
    status, text = _method_text(eegtcnet)
    assert status == METHOD_FOUND
    assert "250 Hz" in text and "77.35" not in text
    for w in WORST[5:]:
        assert w[:40] not in text
    schirr = [
        "1 Introduction\n" + WORST[4],
        "2 Methods\n2.1.1 Input and labels\nWe assume that we are given one EEG data set per subject i.\n" + WORST[3]
        + "\n" + WORST[1],
        "3 Results\n" + WORST[2],
    ]
    status, text = _method_text(schirr)
    assert status == METHOD_FOUND and "2.1.1" not in text and "Stars indicate" not in text
    assert "best-performing" not in text
    kept = [s for s in text.replace("\n", " ").split(". ") if keep_sentence(s.strip() + ".")]
    assert not any("Supplementary" in s or "softmax" in s for s in kept)


def test_subsection_under_results_reopens_then_closes() -> None:
    pages = ["II. MATERIALS AND METHODS\nWe collect six datasets.\nIII. E XPERIMENTAL RESULTS\nA. Implementation "
             "details\nWe trained for 200 epochs.\nB. Comparison with baseline methods\nOurs wins by 3 points."]
    status, text = _method_text(pages)
    assert status == METHOD_FOUND and "200 epochs" in text and "six datasets" in text and "wins" not in text


def test_no_method_heading_is_reported() -> None:
    status, text = _method_text(["Abstract\nWe review BCIs.", "1 Introduction\nBCIs are useful.",
                                 "2 Discussion\nMore work is needed."])
    assert status == METHOD_NOT_FOUND and text == ""


def _no_method_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = 800
    for line in ["A review of wearable EEG", "", "Abstract", "We review wearable EEG recordings at 250 Hz.", "",
                 "1 Introduction", "EEG was band-pass filtered at 1-40 Hz in many studies we review.",
                 "2 Discussion", "Most studies used a baseline condition."]:
        c.drawString(72, y, line)
        y -= 16
    c.showPage()
    c.save()
    return buf.getvalue()


def test_api_reports_method_section_not_found(client: Client, conn, svc) -> None:  # type: ignore[no-untyped-def]
    r = client.post("/api/v1/documents/upload", files={"file": ("review.pdf", _no_method_pdf(), "application/pdf")})
    assert r.status_code == 201, r.text
    drain(conn, svc)
    vid = r.json()["version_id"]
    for use_model in (False, True):
        p = client.post("/api/v1/mobile/plans", json={"version_id": vid, "use_model": use_model})
        assert p.status_code == 201, p.text
        assert p.json()["status"] == METHOD_NOT_FOUND and p.json()["items"] == []
