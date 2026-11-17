"""Student script, version 1: 5-fold cross-validation over shuffled ROWS. The same subject lands in train and test."""

import random

from _knn import accuracy, load

rows = load()
order = list(range(len(rows)))
random.Random(0).shuffle(order)
folds = [(sorted(set(order) - set(order[k::5])), order[k::5]) for k in range(5)]
print(f"accuracy: {accuracy(rows, folds):.4f}")
