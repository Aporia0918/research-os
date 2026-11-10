"""H-01/F-06 step 1 (ADR-271): static leakage audit of a user's script. Synthetic scripts only; the audited code is
parsed, never executed."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from researchos.services.verification.script_audit import audit_file, audit_notebook, audit_source

# Example 1: EEG windows split at random although every window carries its subject.
EXAMPLE_1 = """\
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

df = pd.read_csv("eeg_windows.csv")
X = df.drop(columns=["label", "subject"]).to_numpy()
y = df["label"].to_numpy()
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=0)
model = make_pipeline(StandardScaler(), SVC())
model.fit(X_train, y_train)
print(model.score(X_test, y_test))
"""

# Example 2: the whole data set is standardised before the split.
EXAMPLE_2 = """\
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression

df = pd.read_csv("features.csv")
X = df.filter(like="f_").to_numpy()
y = df["label"].to_numpy()
groups = df["subject"].to_numpy()
X = StandardScaler().fit_transform(X)
train_idx, test_idx = next(GroupShuffleSplit(test_size=0.25, random_state=0).split(X, y, groups))
clf = LogisticRegression().fit(X[train_idx], y[train_idx])
print(clf.score(X[test_idx], y[test_idx]))
"""

# Example 3: random numbers stand in for the recording; no file is read anywhere.
EXAMPLE_3 = """\
import numpy as np
from sklearn.model_selection import GroupKFold, cross_val_score
from sklearn.ensemble import RandomForestClassifier

X = np.random.randn(200, 64)
y = np.random.randint(0, 2, size=200)
subject = np.repeat(np.arange(10), 20)
print(cross_val_score(RandomForestClassifier(), X, y, groups=subject, cv=GroupKFold(5)).mean())
"""

# Clean project: real read, GroupKFold, all preprocessing inside a Pipeline.
CLEAN = """\
import mne
import numpy as np
import pandas as pd
from imblearn.over_sampling import SMOTE
from imblearn.pipeline import Pipeline as ImbPipeline
from sklearn.decomposition import PCA
from sklearn.feature_selection import SelectKBest, f_classif
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GridSearchCV, GroupKFold, cross_val_score
from sklearn.preprocessing import StandardScaler

meta = pd.read_csv("participants.tsv", sep="\\t")
raw = mne.io.read_raw_edf("sub-01_task-rest_eeg.edf", preload=True)
features = np.load("features.npy")
X, y, groups = features, meta["label"].to_numpy(), meta["participant_id"].to_numpy()
pipe = ImbPipeline([
    ("scale", StandardScaler()),
    ("select", SelectKBest(f_classif, k=20)),
    ("pca", PCA(n_components=10)),
    ("smote", SMOTE(random_state=0)),
    ("clf", LogisticRegression(max_iter=1000)),
])
cv = GroupKFold(n_splits=5)
search = GridSearchCV(pipe, {"clf__C": [0.1, 1, 10]}, cv=cv)
search.fit(X, y, groups=groups)
print(cross_val_score(search.best_estimator_, X, y, groups=groups, cv=cv).mean())
"""


def _codes(report: dict[str, object]) -> list[str]:
    return [f["code"] for f in report["findings"]]  # type: ignore[attr-defined]


def _rule(report: dict[str, object], rule: str) -> dict[str, object]:
    return next(r for r in report["rules"] if r["rule"] == rule)  # type: ignore[attr-defined]


def test_example_1_random_split_with_subject_column_is_red() -> None:
    rep = audit_source(EXAMPLE_1)
    r1 = [f for f in rep["findings"] if f["rule"] == "R1"]
    assert r1 and r1[0]["severity"] == "red" and r1[0]["line"] == 11
    assert r1[0]["fix"] and "subject" in r1[0]["fix"].lower()
    assert rep["status"] == "red" and _rule(rep, "R1")["status"] == "red"
    assert _rule(rep, "R2")["status"] == "green"  # scaler inside make_pipeline after the split
    assert _rule(rep, "R3")["status"] == "green"


def test_example_2_scaler_fitted_before_split_is_red() -> None:
    rep = audit_source(EXAMPLE_2)
    r2 = [f for f in rep["findings"] if f["rule"] == "R2"]
    assert [(f["line"], f["severity"], f["code"]) for f in r2] == [(10, "red", "R2.before_split")]
    assert _rule(rep, "R1")["status"] == "green"  # group-aware splitter


def test_example_3_random_data_without_file_read_is_yellow() -> None:
    rep = audit_source(EXAMPLE_3)
    r3 = [f for f in rep["findings"] if f["rule"] == "R3"]
    assert [(f["line"], f["severity"]) for f in r3] == [(5, "yellow"), (6, "yellow")]
    assert _rule(rep, "R3")["status"] == "yellow" and rep["status"] == "yellow"


def test_clean_project_has_at_most_one_false_positive() -> None:
    rep = audit_source(CLEAN)
    assert len(rep["findings"]) <= 1, rep["findings"]
    assert rep["status"] in ("green", "yellow")


def test_example_scripts_also_checked_through_a_notebook(tmp_path: Path) -> None:
    cells = [
        {"cell_type": "markdown", "source": ["# EEG\n"]},
        {"cell_type": "code", "source": ["%matplotlib inline\n", "import numpy as np\n", "!pip list\n"]},
        {"cell_type": "code", "source": EXAMPLE_2.splitlines(keepends=True)},
    ]
    nb = tmp_path / "analysis.ipynb"
    nb.write_text(json.dumps({"cells": cells, "nbformat": 4, "nbformat_minor": 5}), encoding="utf-8")
    rep = audit_file(nb)
    f = next(f for f in rep["findings"] if f["code"] == "R2.before_split")
    assert f["cell"] == 3 and f["cell_line"] == 10  # third cell (1-based, markdown counted), its own line 10
    assert audit_notebook(nb.read_text(encoding="utf-8"))["status"] == "red"


def test_more_r1_r2_r4_patterns() -> None:
    src = """\
import numpy as np
import sklearn.model_selection as ms
from sklearn.preprocessing import StandardScaler as SS
from sklearn.model_selection import RandomizedSearchCV
from xgboost import XGBClassifier

data = np.load("windows.npz")
X, y, sub = data["X"], data["y"], data["subject"]
for tr, te in ms.KFold(5, shuffle=True).split(X):
    sc = SS().fit(X[tr])
X_train, X_test, y_train, y_test = X[:800], X[800:], y[:800], y[800:]
sc2 = SS()
sc2.fit(X_test)
search = RandomizedSearchCV(XGBClassifier(), {"max_depth": [2, 4]}, cv=3)
search.fit(X_test, y_test)
XGBClassifier().fit(X_train, y_train, eval_set=[(X_test, y_test)], early_stopping_rounds=10)
for c in [0.1, 1.0]:
    m = XGBClassifier(learning_rate=c).fit(X_train, y_train)
    print(m.score(X_test, y_test))
"""
    rep = audit_source(src)
    got = {(f["code"], f["line"]) for f in rep["findings"]}
    assert ("R1.random_cv", 9) in got  # aliased module path still resolved
    assert not any(c == "R2.outside_pipeline" and ln == 10 for c, ln in got)  # fitted on the fold's train part
    assert ("R2.fit_on_test", 13) in got
    assert ("R1.default_cv", 14) in got
    assert ("R4.search_on_test", 15) in got
    assert ("R4.early_stop_on_test", 16) in got
    assert ("R4.test_in_loop", 19) in got


def test_subject_level_split_and_columns_hint() -> None:
    src = """\
import pandas as pd
from sklearn.model_selection import train_test_split
df = pd.read_parquet("w.parquet")
train_subjects, test_subjects = train_test_split(df["subject"].unique(), test_size=0.2)
"""
    assert audit_source(src)["findings"] == []  # splitting the subject list itself is the right way
    plain = """\
import pandas as pd
from sklearn.model_selection import train_test_split
df = pd.read_csv("w.csv")
a, b = train_test_split(df, test_size=0.2)
"""
    assert [f["severity"] for f in audit_source(plain)["findings"]] == ["yellow"]  # no subject evidence: check it
    hinted = audit_source(plain, subject_columns=["participant_id"])
    assert [f["severity"] for f in hinted["findings"]] == ["red"]


def test_audit_never_executes_and_reports_syntax_errors(tmp_path: Path) -> None:
    marker = tmp_path / "ran.txt"
    src = f"open({str(marker)!r}, 'w').write('x')\nraise SystemExit(3)\n"
    rep = audit_source(src)
    assert not marker.exists() and rep["status"] in ("green", "yellow")
    bad = audit_source("def broken(:\n    pass\n")
    assert bad["status"] == "error" and bad["error"]["line"] == 1
    big = tmp_path / "big.py"
    big.write_text("x = 1\n" * 400_000, encoding="utf-8")
    assert audit_file(big)["status"] == "error"


# R5 (ADR-276): resampling before the split. Each body runs after a real read with a subject column.
_R5_HEAD = """\
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold, GroupKFold
df = pd.read_csv("features.csv")
X, y, g = df.filter(like="f").values, df["label"].values, df["subject"].values
"""
R5_LEAKS = {
    "imblearn_smote_then_tts": (
        "from imblearn.over_sampling import SMOTE\n"
        "X_res, y_res = SMOTE(random_state=0).fit_resample(X, y)\n"
        "X_train, X_test, y_train, y_test = train_test_split(X_res, y_res)\n"
    ),
    "random_oversampler_then_cv": (
        "from imblearn.over_sampling import RandomOverSampler\n"
        "ros = RandomOverSampler()\nX, y = ros.fit_resample(X, y)\n"
        "print(cross_val_score(M(), X, y, cv=StratifiedKFold(5)))\n"
    ),
    "smote_variants_sample_then_tts": (
        "import smote_variants as sv\noversampler = sv.polynom_fit_SMOTE()\n"
        "Xs, ys = oversampler.sample(X, y)\na, b, c, d = train_test_split(Xs, ys)\n"
    ),
    "undersampler_then_fold_loop": (
        "from imblearn.under_sampling import RandomUnderSampler\n"
        "Xu, yu = RandomUnderSampler().fit_resample(X, y)\n"
        "for tr, te in StratifiedKFold(5).split(Xu, yu):\n    M().fit(Xu[tr], yu[tr])\n"
    ),
    "adasyn_then_helper_with_cv_object": (
        "from imblearn.over_sampling import ADASYN\n"
        "Xa, ya = ADASYN().fit_resample(X, y)\nvalidator = StratifiedKFold(5)\n"
        "preds = evaluate(M(), Xa, ya, validator)\n"
    ),
    "nested_inside_split": (
        "from imblearn.combine import SMOTEENN\n"
        "parts = train_test_split(*SMOTEENN().fit_resample(X, y), test_size=0.3)\n"
    ),
    "sklearn_resample_upsampling": (
        "from sklearn.utils import resample\n"
        "X_up, y_up = resample(X, y, replace=True, n_samples=2 * len(X))\n"
        "cross_val_score(M(), X_up, y_up, groups=g, cv=GroupKFold(5))\n"
    ),
}
R5_CLEAN = {
    "imblearn_pipeline_in_cv": (
        "from imblearn.pipeline import make_pipeline\n"
        "from imblearn.over_sampling import SMOTE\n"
        "pipe = make_pipeline(SMOTE(), M())\n"
        "cross_val_score(pipe, X, y, groups=g, cv=GroupKFold(5))\n"
    ),
    "smote_on_train_only": (
        "from imblearn.over_sampling import SMOTE\n"
        "tr_s, te_s = train_test_split(np.unique(g), test_size=0.2)\n"
        "X_train, y_train = X[np.isin(g, tr_s)], y[np.isin(g, tr_s)]\n"
        "X_train_s, y_train_s = SMOTE().fit_resample(X_train, y_train)\n"
        "M().fit(X_train_s, y_train_s)\n"
    ),
    "smote_variants_on_fold_train": (
        "import smote_variants as sv\n"
        "for tr, te in GroupKFold(5).split(X, y, g):\n"
        "    Xs, ys = sv.SMOTE().sample(X[tr], y[tr])\n    M().fit(Xs, ys)\n"
    ),
    "pandas_sample_is_not_resampling": (
        "df = df.sample(frac=1.0, random_state=0)\ns_tr, s_te = train_test_split(df['subject'].unique())\n"
    ),
    "resample_without_any_split": (
        "from imblearn.over_sampling import SMOTE\n"
        "X_all, y_all = SMOTE().fit_resample(X, y)\nfinal = M().fit(X_all, y_all)\n"
    ),
    "oversampling_classifier_wrapper": (
        "import smote_variants as sv\n"
        "oc = sv.OversamplingClassifier(sv.SMOTE(), M())\n"
        "cross_val_score(oc, X, y, groups=g, cv=GroupKFold(5))\n"
    ),
}


@pytest.mark.parametrize("name", sorted(R5_LEAKS))
def test_r5_resampling_before_split_is_red(name: str) -> None:
    rep = audit_source(_R5_HEAD + R5_LEAKS[name])
    r5 = [f for f in rep["findings"] if f["rule"] == "R5"]
    assert r5 and all(f["severity"] == "red" and f["code"] == "R5.before_split" for f in r5), rep["findings"]
    assert "training part" in r5[0]["fix"] and "Pipeline" in r5[0]["fix"]
    assert next(r for r in rep["rules"] if r["rule"] == "R5")["status"] == "red"


@pytest.mark.parametrize("name", sorted(R5_CLEAN))
def test_r5_resampling_inside_pipeline_or_on_train_part_is_green(name: str) -> None:
    rep = audit_source(_R5_HEAD + R5_CLEAN[name])
    assert not [f for f in rep["findings"] if f["rule"] in ("R5", "R2")], rep["findings"]


def test_r5_resampling_the_test_part_is_red() -> None:
    src = _R5_HEAD + (
        "from imblearn.over_sampling import SMOTE\nX_train, X_test, y_train, y_test = X[:80], X[80:], "
        "y[:80], y[80:]\nX_test, y_test = SMOTE().fit_resample(X_test, y_test)\n"
    )
    assert [(f["code"], f["severity"]) for f in audit_source(src)["findings"] if f["rule"] == "R5"] == [
        ("R5.on_test", "red")
    ]


# Keras validation_split (ADR-277): yellow when rows share subjects and the arrays are not ordered by subject.
_KERAS_HEAD = """\
import numpy as np
import pandas as pd
from tensorflow import keras
df = pd.read_csv("windows.csv")
X, y = df.filter(like="f").values, df["label"].values
"""
_SUBJ = 'g = df["subject"].values\n'
VS_LEAKS = {
    "plain": (_SUBJ + "model.fit(X, y, epochs=10, validation_split=0.2)\n", ()),
    "shuffle_true_does_not_help": (_SUBJ + "model.fit(X, y, shuffle=True, validation_split=0.1)\n", ()),
    "after_group_split_on_train_part": (
        _SUBJ + "from sklearn.model_selection import GroupShuffleSplit\n"
        "tr, te = next(GroupShuffleSplit().split(X, y, g))\n"
        "history = net.fit(x=X[tr], y=y[tr], validation_split=.25)\n",
        (),
    ),
    "subject_column_given_by_caller": ("model.fit(X, y, validation_split=0.2)\n", ("participant_id",)),
    "fraction_in_a_variable": (_SUBJ + "vs = 0.15\nmodel.fit(X, y, validation_split=vs)\n", ()),
    "with_early_stopping": (
        _SUBJ + "cb = [keras.callbacks.EarlyStopping(patience=3)]\n"
        "model.fit(X, y, validation_split=0.2, callbacks=cb)\n",
        (),
    ),
}
VS_CLEAN = {
    "zero_fraction": (_SUBJ + "model.fit(X, y, validation_split=0.0)\n", ()),
    "none_fraction": (_SUBJ + "model.fit(X, y, validation_split=None)\n", ()),
    "no_subject_evidence": ("model.fit(X, y, validation_split=0.2)\n", ()),
    "own_validation_data": (_SUBJ + "model.fit(X[:800], y[:800], validation_data=(X[800:], y[800:]))\n", ()),
    "validation_data_overrides_split": (
        _SUBJ + "model.fit(X, y, validation_split=0.2, validation_data=(X_val, y_val))\n",
        (),
    ),
    "rows_ordered_by_subject": (_SUBJ + 'df = df.sort_values("subject")\nmodel.fit(X, y, validation_split=0.2)\n', ()),
    "argsort_by_subject": (
        _SUBJ + "order = np.argsort(g, kind='stable')\nmodel.fit(X[order], y[order], validation_split=0.2)\n",
        (),
    ),
}


@pytest.mark.parametrize("name", sorted(VS_LEAKS))
def test_keras_validation_split_with_shared_subjects_is_yellow(name: str) -> None:
    body, cols = VS_LEAKS[name]
    rep = audit_source(_KERAS_HEAD + body, subject_columns=cols)
    vs = [f for f in rep["findings"] if f["code"] == "R1.validation_split"]
    assert len(vs) == 1 and vs[0]["severity"] == "yellow", rep["findings"]
    assert "last rows" in vs[0]["message"] and "subject" in vs[0]["message"]
    assert "validation_data" in vs[0]["fix"]


@pytest.mark.parametrize("name", sorted(VS_CLEAN))
def test_keras_validation_split_clean_variants_pass(name: str) -> None:
    body, cols = VS_CLEAN[name]
    rep = audit_source(_KERAS_HEAD + body, subject_columns=cols)
    assert not [f for f in rep["findings"] if f["code"] == "R1.validation_split"], rep["findings"]


# Hand-written standardisation / normalisation with whole-array statistics before the split (ADR-278): R2 red.
_NORM_HEAD = """\
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit, GroupKFold, cross_val_score, train_test_split
df = pd.read_csv("features.csv")
X, y, g = df.filter(like="f").values, df["label"].values, df["subject"].values
"""
_GSPLIT = "tr, te = next(GroupShuffleSplit().split(X, y, g))\n"
NORM_LEAKS = {
    "zscore_method_axis0": "X = (X - X.mean(0)) / X.std(0)\n" + _GSPLIT,
    "divide_by_global_max": "X = X / X.max()\nX_train, X_test, y_train, y_test = train_test_split(X, y)\n",
    "numpy_stats_in_variables": (
        "mu, sd = np.mean(X, axis=0), np.std(X, axis=0)\nXn = (X - mu) / sd\n"
        "cross_val_score(M(), Xn, y, groups=g, cv=GroupKFold(5))\n"
    ),
    "pandas_default_axis": (
        'feats = df.filter(like="f")\nfeats_n = (feats - feats.mean()) / feats.std()\n'
        "a, b = train_test_split(feats_n, test_size=0.2)\n"
    ),
    "in_place_operators": "X -= X.mean(axis=0)\nX /= X.std(axis=0)\n" + _GSPLIT,
    "min_max_by_hand": "X = (X - X.min(axis=0)) / (X.max(axis=0) - X.min(axis=0))\n" + _GSPLIT,
}
NORM_CLEAN = {
    "train_statistics_only": (
        _GSPLIT + "X_train, X_test = X[tr], X[te]\nmu, sd = X_train.mean(0), X_train.std(0)\n"
        "X_train = (X_train - mu) / sd\nX_test = (X_test - mu) / sd\n"
    ),
    "per_sample_axis1": "X = X / X.max(axis=1, keepdims=True)\n" + _GSPLIT,
    "per_window_last_axis": "X = (X - X.mean(axis=-1, keepdims=True)) / X.std(axis=-1, keepdims=True)\n" + _GSPLIT,
    "constant_scale": "X = X / 255.0\n" + _GSPLIT,
    "fold_train_statistics": (
        "for tr, te in GroupKFold(5).split(X, y, g):\n    mu = X[tr].mean(0)\n    m = M().fit(X[tr] - mu, y[tr])\n"
    ),
    "normalised_but_never_split": "X = (X - X.mean(0)) / X.std(0)\nfinal = M().fit(X, y)\n",
}


@pytest.mark.parametrize("name", sorted(NORM_LEAKS))
def test_manual_normalisation_with_whole_array_stats_before_split_is_red(name: str) -> None:
    rep = audit_source(_NORM_HEAD + NORM_LEAKS[name])
    r2 = [f for f in rep["findings"] if f["code"] == "R2.manual_stats_before_split"]
    assert r2 and all(f["severity"] == "red" for f in r2), rep["findings"]
    assert "whole" in r2[0]["message"] and "training part" in r2[0]["fix"]


@pytest.mark.parametrize("name", sorted(NORM_CLEAN))
def test_manual_normalisation_on_train_part_or_per_sample_passes(name: str) -> None:
    rep = audit_source(_NORM_HEAD + NORM_CLEAN[name])
    assert not [f for f in rep["findings"] if f["rule"] == "R2"], rep["findings"]
