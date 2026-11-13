"""Reference for B2: the same oversampled table and model, folds cut by sample_id so copies stay together."""

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold, cross_val_score

df = pd.read_csv("data.csv")
y, groups = df.pop("label"), df.pop("sample_id")
model = RandomForestClassifier(n_estimators=100, random_state=0)
scores = cross_val_score(model, df, y, groups=groups, cv=GroupKFold(5))
print(f"accuracy: {scores.mean():.4f}")
