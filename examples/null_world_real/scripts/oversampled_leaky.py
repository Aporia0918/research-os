"""Case B2, leaky: the table was oversampled before the split, and folds are cut by row, so copies of one sample
land in both train and test."""

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score

df = pd.read_csv("data.csv")
y, X = df.pop("label"), df.drop(columns="sample_id")
model = RandomForestClassifier(n_estimators=100, random_state=0)
scores = cross_val_score(model, X, y, cv=StratifiedKFold(5, shuffle=True, random_state=0))
print(f"accuracy: {scores.mean():.4f}")
