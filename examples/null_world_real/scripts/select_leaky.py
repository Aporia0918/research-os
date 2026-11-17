"""Case B1, leaky: scaling and SelectKBest see all rows (labels included) before cross-validation."""

import pandas as pd
from sklearn.feature_selection import SelectKBest, f_classif
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.preprocessing import StandardScaler

df = pd.read_csv("data.csv")
y, X = df.pop("label"), df.drop(columns="sample_id")
X = SelectKBest(f_classif, k=10).fit_transform(StandardScaler().fit_transform(X), y)  # the mistake
scores = cross_val_score(LogisticRegression(max_iter=5000), X, y, cv=StratifiedKFold(5, shuffle=True, random_state=0))
print(f"accuracy: {scores.mean():.4f}")
