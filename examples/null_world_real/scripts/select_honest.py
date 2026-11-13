"""Reference for B1: the same steps, fitted inside each fold."""

import pandas as pd
from sklearn.feature_selection import SelectKBest, f_classif
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

df = pd.read_csv("data.csv")
y, X = df.pop("label"), df.drop(columns="sample_id")
model = make_pipeline(StandardScaler(), SelectKBest(f_classif, k=10), LogisticRegression(max_iter=5000))
scores = cross_val_score(model, X, y, cv=StratifiedKFold(5, shuffle=True, random_state=0))
print(f"accuracy: {scores.mean():.4f}")
