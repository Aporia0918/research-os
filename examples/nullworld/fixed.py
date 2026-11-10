"""Student script, version 2: 5-fold cross-validation over SUBJECTS. No subject is in both train and test."""

import random

from _knn import accuracy, load

rows = load()
subjects = sorted({r[0] for r in rows})
random.Random(0).shuffle(subjects)
fold_of = {s: k % 5 for k, s in enumerate(subjects)}
folds = [
    ([i for i, r in enumerate(rows) if fold_of[r[0]] != k], [i for i, r in enumerate(rows) if fold_of[r[0]] == k])
    for k in range(5)
]
print(f"accuracy: {accuracy(rows, folds):.4f}")
