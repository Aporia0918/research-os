"""Synthetic ECG-like features: 60 subjects x 8 windows, one AF label per subject.

`rr` carries a real AF signal; `morph` is a per-subject fingerprint with no relation to AF. Windows of one subject sit
close together, so a model that sees the same subject in training and testing can score by recognising the subject.
"""

from __future__ import annotations

import csv
import random
import sys
from pathlib import Path


def write_demo(path: Path, seed: int = 7, subjects: int = 60, windows: int = 8) -> None:
    rng = random.Random(seed)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["subject", "window", "rr", "morph", "af"])
        for s in range(subjects):
            af = s % 2
            rr, morph = 3.0 * af + rng.gauss(0, 0.6), rng.uniform(-1, 1)
            for k in range(windows):
                w.writerow([f"S{s:02d}", k, f"{rr + rng.gauss(0, 0.03):.4f}", f"{morph + rng.gauss(0, 0.03):.4f}", af])


if __name__ == "__main__":
    write_demo(Path(sys.argv[1] if len(sys.argv) > 1 else "ecg_features.csv"))
