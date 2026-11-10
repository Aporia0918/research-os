"""Tiny 1-nearest-neighbour classifier shared by the two demo scripts (pure Python, no dependencies)."""

import csv


def load(path="ecg_features.csv"):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    return [(r["subject"], (float(r["rr"]), float(r["morph"])), r["af"]) for r in rows]


def accuracy(rows, folds):
    """Mean 1-NN accuracy over (train_idx, test_idx) folds."""
    hits = total = 0
    for train, test in folds:
        for i in test:
            x = rows[i][1]
            j = min(train, key=lambda t: (rows[t][1][0] - x[0]) ** 2 + (rows[t][1][1] - x[1]) ** 2)
            hits += rows[j][2] == rows[i][2]
            total += 1
    return hits / total
