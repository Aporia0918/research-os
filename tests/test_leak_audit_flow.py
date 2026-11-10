"""Leak audit, rules added after blind cases 3/4 (ADR-279..): data fitted or copied on all rows before the split
or CV, and unparsable lines. Generic synthetic snippets (ECG, MRI features, clinical tables, text), written for
these tests; the blind cases themselves are not used as fixtures. Parsed, never executed."""

from __future__ import annotations

import pytest

from researchos.services.verification.script_audit import audit_source

# Unparsable lines (ADR-279): a stray non-code line is skipped (blanked) and reported; the rest is still audited.
_ECG_HEAD = """\
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
beats = pd.read_csv("ecg_beats.csv")
X, y = beats.filter(like="lead").values, beats["arrhythmia"].values
"""
PARSE_CASES = {  # name -> (script after the head, skipped head-relative lines)
    "english_line_in_function_body": (
        "def load_all(paths):\n    out = []\n    for p in paths:\n"
        "        only reload when the cache is stale\n"
        "        out.append(np.load(p))\n    return out\n"
        "X = StandardScaler().fit_transform(X)\na, b, c, d = train_test_split(X, y)\n",
        [4],
    ),
    "english_line_at_top_level": (
        "now scale everything\nX = StandardScaler().fit_transform(X)\na, b, c, d = train_test_split(X, y)\n",
        [1],
    ),
    "two_stray_lines": (
        "TODO check the sampling rate\nX = StandardScaler().fit_transform(X)\n"
        "if True:\n    see notes from the meeting\n    pass\na, b, c, d = train_test_split(X, y)\n",
        [1, 4],
    ),
    "merge_conflict_marker": (
        "<<<<<<< HEAD\nX = StandardScaler().fit_transform(X)\na, b, c, d = train_test_split(X, y)\n",
        [1],
    ),
    "lone_bad_statement_in_block": (
        "for i in range(3):\n    print the progress\n"
        "X = StandardScaler().fit_transform(X)\na, b, c, d = train_test_split(X, y)\n",
        [2],
    ),
    "python2_print": (
        'print "starting"\nX = StandardScaler().fit_transform(X)\na, b, c, d = train_test_split(X, y)\n',
        [1],
    ),
}


@pytest.mark.parametrize("name", sorted(PARSE_CASES))
def test_unparsable_lines_are_skipped_reported_and_the_rest_is_audited(name: str) -> None:
    body, rel = PARSE_CASES[name]
    rep = audit_source(_ECG_HEAD + body)
    lines = [n + _ECG_HEAD.count("\n") for n in rel]
    skipped = [f for f in rep["findings"] if f["code"] == "PARSE.skipped_line"]
    assert [f["line"] for f in skipped] == lines and rep["skipped_lines"] == lines, rep
    assert all(f["severity"] == "yellow" for f in skipped)
    assert skipped[0]["message"].startswith(f"line {lines[0]} is not valid Python: ")
    assert skipped[0]["message"].endswith("; the audit continued on the parsable part")
    assert rep["status"] == "red" and "R2.before_split" in [f["code"] for f in rep["findings"]]


def test_parse_recovery_gives_up_after_five_lines_or_when_nothing_is_left() -> None:
    six = "".join(f"stray words number {i}\n" for i in range(6)) + "x = 1\n"
    assert audit_source(six)["status"] == "error"
    five = "".join(f"stray words number {i}\n" for i in range(5)) + "x = 1\n"
    assert audit_source(five)["skipped_lines"] == [1, 2, 3, 4, 5]
    assert audit_source("this is only prose\n")["status"] == "error"


def test_clean_script_reports_no_skipped_lines() -> None:
    rep = audit_source(_ECG_HEAD + "a, b, c, d = train_test_split(X, y)\n")
    assert rep["skipped_lines"] == [] and not [f for f in rep["findings"] if f["rule"] == "PARSE"]


def _flow(src: str, code: str) -> list[dict[str, object]]:
    return [f for f in audit_source(src)["findings"] if f["code"] == code]


# Feature selection on all rows before the split / CV (ADR-280): red R2.select_before_split.
_MRI_HEAD = """\
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.model_selection import GroupKFold, KFold, cross_val_score, train_test_split
from sklearn.feature_selection import SelectFromModel, VarianceThreshold, f_regression, mutual_info_classif, RFECV
from sklearn.linear_model import Lasso, LogisticRegression
from sklearn.svm import LinearSVC
morph = pd.read_csv("freesurfer_thickness.csv")
feats, outcome, site_id = morph.filter(like="ctx_").values, morph["mmse"].values, morph["participant"].values
"""
SELECT_LEAKS = {
    "select_from_model_then_cv": (
        "picker = SelectFromModel(LinearSVC(penalty='l1', dual=False)).fit(feats, outcome)\n"
        "reduced = picker.transform(feats)\n"
        "cross_val_score(LogisticRegression(), reduced, outcome, groups=site_id, "
        "cv=GroupKFold(4))\n"
    ),
    "univariate_scores_top_k_by_hand": (
        "fval, pval = f_regression(feats, outcome)\n"
        "keep = np.argsort(pval)[:50]\nsmall = feats[:, keep]\n"
        "tr_x, te_x, tr_y, te_y = train_test_split(small, outcome, test_size=0.3)\n"
    ),
    "correlation_with_target_by_hand": (
        "r = np.array([np.corrcoef(feats[:, j], outcome)[0, 1] "
        "for j in range(feats.shape[1])])\n"
        "top = np.abs(r).argsort()[-20:]\n"
        "for a, b in GroupKFold(5).split(feats, outcome, site_id):\n"
        "    m = Lasso().fit(feats[a][:, top], outcome[a])\n"
    ),
    "t_test_between_classes": (
        "t, p = stats.ttest_ind(feats[outcome > 24], feats[outcome <= 24])\n"
        "mask = p < 0.01\nsel = feats[:, mask]\n"
        "cross_val_score(LogisticRegression(), sel, outcome > 24, cv=KFold(5))\n"
    ),
    "lasso_coefficients_pick_columns": (
        "las = Lasso(alpha=0.05)\nlas.fit(feats, outcome)\n"
        "nz = np.flatnonzero(las.coef_)\n"
        "parts = train_test_split(feats[:, nz], outcome)\n"
    ),
    "mutual_information_ranking": (
        "mi = mutual_info_classif(feats, outcome > 24)\n"
        "best = np.argsort(mi)[::-1][:30]\n"
        "cross_val_score(LogisticRegression(), feats[:, best], outcome > 24, cv=5)\n"
    ),
    "rfecv_fit_transform_then_split": (
        "thin = RFECV(LinearSVC()).fit_transform(feats, outcome > 24)\npieces = train_test_split(thin, outcome)\n"
    ),
    "variance_threshold_given_labels": (
        "vt = VarianceThreshold(0.1).fit(feats, outcome)\n"
        "slim = vt.transform(feats)\n"
        "cross_val_score(Lasso(), slim, outcome, groups=site_id, cv=GroupKFold(3))\n"
    ),
}
SELECT_CLEAN = {
    "select_inside_each_fold": (
        "for a, b in GroupKFold(5).split(feats, outcome, site_id):\n"
        "    fval, pval = f_regression(feats[a], outcome[a])\n"
        "    keep = np.argsort(pval)[:50]\n"
        "    m = Lasso().fit(feats[a][:, keep], outcome[a])\n"
    ),
    "select_on_train_part_only": (
        "x_train, x_test, y_train, y_test = train_test_split(feats, outcome)\n"
        "picker = SelectFromModel(Lasso()).fit(x_train, y_train)\n"
        "m = Lasso().fit(picker.transform(x_train), y_train)\n"
    ),
    "selection_in_a_pipeline": (
        "from sklearn.pipeline import make_pipeline\n"
        "pipe = make_pipeline(SelectFromModel(Lasso()), Lasso())\n"
        "cross_val_score(pipe, feats, outcome, groups=site_id, cv=GroupKFold(5))\n"
    ),
    "lasso_fit_on_all_then_cv_of_the_model": (
        "las = Lasso(alpha=0.05).fit(feats, outcome)\n"
        "cross_val_score(Lasso(alpha=0.05), feats, outcome, groups=site_id, "
        "cv=GroupKFold(5))\nprint(las.coef_)\n"
    ),
    "selection_but_no_split_afterwards": (
        "fval, pval = f_regression(feats, outcome)\nprint(feats[:, pval < 0.05].shape)\n"
    ),
    "variance_threshold_without_labels": (
        "slim = VarianceThreshold(0.0).fit_transform(feats)\n"
        "cross_val_score(Lasso(), slim, outcome, groups=site_id, "
        "cv=GroupKFold(3))\n"
    ),
    "correlation_between_features_only": (
        "cc = np.corrcoef(feats.T)\ncross_val_score(Lasso(), feats, outcome, groups=site_id, cv=GroupKFold(3))\n"
    ),
}


@pytest.mark.parametrize("name", sorted(SELECT_LEAKS))
def test_feature_selection_on_all_rows_before_split_is_red(name: str) -> None:
    hits = _flow(_MRI_HEAD + SELECT_LEAKS[name], "R2.select_before_split")
    assert hits and all(f["severity"] == "red" for f in hits), audit_source(_MRI_HEAD + SELECT_LEAKS[name])
    assert "selected" in str(hits[0]["message"]) and "training" in str(hits[0]["fix"])


@pytest.mark.parametrize("name", sorted(SELECT_CLEAN))
def test_feature_selection_per_fold_on_train_or_without_split_passes(name: str) -> None:
    rep = audit_source(_MRI_HEAD + SELECT_CLEAN[name])
    assert not [f for f in rep["findings"] if f["rule"] == "R2"], rep["findings"]


# Target scaling / transform fitted on all labels before the split (ADR-281): red R2.target_before_split.
_ICU_HEAD = """\
import numpy as np
import pandas as pd
from scipy.stats import zscore
from sklearn.preprocessing import QuantileTransformer, StandardScaler, PowerTransformer, scale
from sklearn.model_selection import train_test_split, cross_val_score, GroupKFold, KFold
from sklearn.linear_model import Ridge
icu = pd.read_parquet("icu_stays.parquet")
X, los, pid = icu.drop(columns=["los_days", "patient_id"]).values, icu["los_days"].values, icu["patient_id"].values
"""
TARGET_LEAKS = {  # `los` is no label-like name: it is known as the target because it is passed as y
    "scipy_zscore_then_split": "los_z = zscore(los)\nparts = train_test_split(X, los_z, test_size=0.2)\n",
    "hand_written_zscore": (
        "los = (los - los.mean()) / los.std()\ncross_val_score(Ridge(), X, los, groups=pid, cv=GroupKFold(5))\n"
    ),
    "quantile_transformer": (
        "qt = QuantileTransformer(output_distribution='normal')\n"
        "los_q = qt.fit_transform(los.reshape(-1, 1)).ravel()\n"
        "cross_val_score(Ridge(), X, los_q, cv=KFold(5))\n"
    ),
    "standard_scaler_then_fold_loop": (
        "los_s = StandardScaler().fit_transform(los[:, None])[:, 0]\n"
        "for a, b in GroupKFold(4).split(X, los_s, pid):\n"
        "    Ridge().fit(X[a], los_s[a])\n"
    ),
    "sklearn_scale_function": "los_n = scale(los)\npieces = train_test_split(X, los_n)\n",
    "power_transformer_fit_then_transform": (
        "pt = PowerTransformer()\npt.fit(los.reshape(-1, 1))\n"
        "los_t = pt.transform(los.reshape(-1, 1)).ravel()\n"
        "cross_val_score(Ridge(), X, los_t, groups=pid, cv=GroupKFold(3))\n"
    ),
    "label_named_target_min_max": (
        "severity = icu['sofa'].values\n"
        "y_sev = (severity - severity.min()) / (severity.max() - severity.min())\n"
        "a, b, c, d = train_test_split(X, y_sev)\n"
    ),
}
TARGET_CLEAN = {
    "train_statistics_only": (
        "x_train, x_test, y_train, y_test = train_test_split(X, los)\n"
        "mu, sd = y_train.mean(), y_train.std()\n"
        "y_train = (y_train - mu) / sd\ny_test = (y_test - mu) / sd\n"
    ),
    "log_is_per_row": "los_log = np.log1p(los)\nparts = train_test_split(X, los_log)\n",
    "scaler_on_training_target": (
        "x_train, x_test, y_train, y_test = train_test_split(X, los)\n"
        "sc = StandardScaler().fit(y_train.reshape(-1, 1))\n"
    ),
    "transformed_target_regressor": (
        "from sklearn.compose import TransformedTargetRegressor\n"
        "m = TransformedTargetRegressor(Ridge(), transformer=QuantileTransformer())\n"
        "cross_val_score(m, X, los, groups=pid, cv=GroupKFold(5))\n"
    ),
    "zscore_per_row_axis1": "X = zscore(X, axis=1)\nparts = train_test_split(X, los)\n",
    "zscored_but_never_split": "los_z = zscore(los)\nprint(los_z.max())\n",
    "zscore_inside_fold_on_train": (
        "for a, b in GroupKFold(5).split(X, los, pid):\n    yz = zscore(los[a])\n    Ridge().fit(X[a], yz)\n"
    ),
}


@pytest.mark.parametrize("name", sorted(TARGET_LEAKS))
def test_target_scaled_on_all_labels_before_split_is_red(name: str) -> None:
    rep = audit_source(_ICU_HEAD + TARGET_LEAKS[name])
    hits = [f for f in rep["findings"] if f["code"] == "R2.target_before_split"]
    assert hits and all(f["severity"] == "red" for f in hits), rep["findings"]
    assert "labels" in hits[0]["message"] and "training" in hits[0]["fix"]
    assert not [f for f in rep["findings"] if f["code"] in ("R2.before_split", "R2.manual_stats_before_split")]


@pytest.mark.parametrize("name", sorted(TARGET_CLEAN))
def test_target_transform_on_training_labels_or_per_row_passes(name: str) -> None:
    rep = audit_source(_ICU_HEAD + TARGET_CLEAN[name])
    assert not [f for f in rep["findings"] if f["rule"] == "R2"], rep["findings"]


def test_feature_scaling_functions_on_all_rows_are_manual_stats_red() -> None:
    for body in (
        "X = zscore(X)\nparts = train_test_split(X, los)\n",
        "Xs = scale(X, axis=0)\ncross_val_score(Ridge(), Xs, los, groups=pid, cv=GroupKFold(5))\n",
    ):
        assert [f["code"] for f in audit_source(_ICU_HEAD + body)["findings"] if f["rule"] == "R2"] == [
            "R2.manual_stats_before_split"
        ], body


# Covariate / confound regression fitted on all rows before the split (ADR-282): red R2.confound_before_split.
_ROI_HEAD = """\
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from nilearn import signal
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.model_selection import GroupKFold, StratifiedKFold, cross_val_score, train_test_split
tab = pd.read_csv("roi_volumes.csv")
vol, dx_group, subj = tab.filter(like="roi_").values, tab["dx"].values, tab["subject_id"].values
covars = tab[["age", "sex"]].values
"""
CONF_LEAKS = {
    "linear_regression_residuals": (
        "reg = LinearRegression().fit(covars, vol)\nvol_res = vol - reg.predict(covars)\n"
        "cross_val_score(LogisticRegression(), vol_res, dx_group, groups=subj, "
        "cv=GroupKFold(5))\n"
    ),
    "statsmodels_ols_resid_per_column": (
        "clean = np.column_stack([sm.OLS(vol[:, j], sm.add_constant(covars)).fit()"
        ".resid for j in range(vol.shape[1])])\n"
        "parts = train_test_split(clean, dx_group)\n"
    ),
    "formula_ols_resid": (
        'tab["hippo_adj"] = smf.ols("hippo ~ age + C(sex) + site", data=tab).fit().resid\n'
        'cross_val_score(LogisticRegression(), tab[["hippo_adj"]], dx_group, '
        "cv=StratifiedKFold(5))\n"
    ),
    "least_squares_betas_by_hand": (
        'design = np.column_stack([np.ones(len(tab)), tab["age"], tab["sex"]])\n'
        "beta = np.linalg.lstsq(design, vol, rcond=None)[0]\n"
        "vol_adj = vol - design @ beta\n"
        "for a, b in StratifiedKFold(5).split(vol_adj, dx_group):\n"
        "    LogisticRegression().fit(vol_adj[a], dx_group[a])\n"
    ),
    "nilearn_signal_clean_on_subject_matrix": (
        "vol_c = signal.clean(vol, confounds=covars)\ncross_val_score(LogisticRegression(), vol_c, dx_group, cv=5)\n"
    ),
    "fit_then_subtract_in_place": (
        'deconf = LinearRegression()\ndeconf.fit(tab[["age", "sex", "site"]], vol)\n'
        'vol -= deconf.predict(tab[["age", "sex", "site"]])\n'
        "parts = train_test_split(vol, dx_group, test_size=0.25)\n"
    ),
}
CONF_CLEAN = {
    "deconfounding_fitted_on_train": (
        "vol_train, vol_test, cov_train, cov_test = train_test_split(vol, covars)\n"
        "reg = LinearRegression().fit(cov_train, vol_train)\n"
        "vol_train = vol_train - reg.predict(cov_train)\n"
        "vol_test = vol_test - reg.predict(cov_test)\n"
    ),
    "per_fold_deconfounding": (
        "for a, b in GroupKFold(5).split(vol, dx_group, subj):\n"
        "    reg = LinearRegression().fit(covars[a], vol[a])\n"
        "    res_a = vol[a] - reg.predict(covars[a])\n"
    ),
    "model_from_age_is_not_deconfounding": (
        "m = LinearRegression().fit(covars, dx_group)\n"
        "print(m.score(covars, dx_group))\n"
        "cross_val_score(LogisticRegression(), vol, dx_group, groups=subj, "
        "cv=GroupKFold(5))\n"
    ),
    "residuals_for_diagnostics_only": (
        "ols = sm.OLS(dx_group, sm.add_constant(vol[:, :3])).fit()\n"
        "print(ols.resid.std())\n"
        "cross_val_score(LogisticRegression(), vol, dx_group, groups=subj, "
        "cv=GroupKFold(5))\n"
    ),
    "signal_clean_per_recording": (
        "series = [signal.clean(np.load(f), confounds=np.load(c)) "
        "for f, c in zip(tab['bold'], tab['motion_file'])]\n"
        "conn = np.array([np.corrcoef(s.T)[np.triu_indices(10, 1)] for s in series])\n"
        "cross_val_score(LogisticRegression(), conn, dx_group, groups=subj, "
        "cv=GroupKFold(5))\n"
    ),
    "confound_regression_never_split": (
        'vol_res = vol - LinearRegression().fit(covars, vol).predict(covars)\nnp.save("vol_res.npy", vol_res)\n'
    ),
    "subtracting_a_baseline_is_not_a_fit": (
        'vol_change = vol - tab.filter(like="base_").values\nparts = train_test_split(vol_change, dx_group)\n'
    ),
}


@pytest.mark.parametrize("name", sorted(CONF_LEAKS))
def test_confound_regression_on_all_rows_before_split_is_red(name: str) -> None:
    rep = audit_source(_ROI_HEAD + CONF_LEAKS[name])
    hits = [f for f in rep["findings"] if f["code"] == "R2.confound_before_split"]
    assert hits and all(f["severity"] == "red" for f in hits), rep["findings"]
    assert "confound" in hits[0]["message"] and "training" in hits[0]["fix"]


@pytest.mark.parametrize("name", sorted(CONF_CLEAN))
def test_confound_regression_on_train_part_or_per_recording_passes(name: str) -> None:
    rep = audit_source(_ROI_HEAD + CONF_CLEAN[name])
    assert not [f for f in rep["findings"] if f["rule"] == "R2"], rep["findings"]


# Site / batch harmonisation (ComBat) fitted on all rows before the split (ADR-283): red R2.harmonise_before_split.
HARM_LEAKS = {
    "neurocombat_on_all_subjects": (
        "from neuroCombat import neuroCombat\n"
        'harm = neuroCombat(dat=vol.T, covars=tab[["scanner", "age"]], '
        'batch_col="scanner")["data"].T\n'
        "cross_val_score(LogisticRegression(), harm, dx_group, groups=subj, "
        "cv=GroupKFold(5))\n"
    ),
    "neuroharmonize_learn": (
        "from neuroHarmonize import harmonizationLearn\n"
        'model, vol_h = harmonizationLearn(vol, tab[["SITE", "age"]])\n'
        "parts = train_test_split(vol_h, dx_group)\n"
    ),
    "pycombat_expression_matrix": (
        "from combat.pycombat import pycombat\n"
        'expr_c = pycombat(pd.DataFrame(vol.T), tab["scanner"].tolist()).T.values\n'
        "for a, b in StratifiedKFold(5).split(expr_c, dx_group):\n"
        "    LogisticRegression().fit(expr_c[a], dx_group[a])\n"
    ),
    "combat_model_fit_transform": (
        "from neurocombat_sklearn import CombatModel\n"
        'vol_cb = CombatModel().fit_transform(vol, tab[["scanner"]], tab[["sex"]])\n'
        "cross_val_score(LogisticRegression(), vol_cb, dx_group, cv=StratifiedKFold(5))\n"
    ),
    "own_helper_named_combat": (
        'vol_h = combat(vol, batch=tab["scanner"].values)\nparts = train_test_split(vol_h, dx_group, test_size=0.2)\n'
    ),
    "harmonised_inside_the_fold_loop_on_all_rows": (
        "from neuroCombat import neuroCombat\n"
        "for a, b in GroupKFold(5).split(vol, dx_group, subj):\n"
        '    vh = neuroCombat(dat=vol.T, covars=tab, batch_col="scanner")'
        '["data"].T\n'
        "    LogisticRegression().fit(vh[a], dx_group[a])\n"
    ),
}
HARM_CLEAN = {
    "learn_on_train_apply_to_test": (
        "from neuroHarmonize import harmonizationLearn, harmonizationApply\n"
        "vol_train, vol_test, cov_train, cov_test = train_test_split(vol, tab)\n"
        "model, vol_train_h = harmonizationLearn(vol_train, cov_train)\n"
        "vol_test_h = harmonizationApply(vol_test, cov_test, model)\n"
    ),
    "combat_model_fit_on_fold_train": (
        "from neurocombat_sklearn import CombatModel\n"
        'sites = tab[["scanner"]].values\n'
        "for a, b in GroupKFold(5).split(vol, dx_group, subj):\n"
        "    cm = CombatModel().fit(vol[a], sites[a])\n"
        "    LogisticRegression().fit(cm.transform(vol[a], sites[a]), dx_group[a])\n"
    ),
    "harmonised_but_never_split": (
        "from neuroCombat import neuroCombat\n"
        'harm = neuroCombat(dat=vol.T, covars=tab, batch_col="scanner")["data"]\n'
        'np.save("harm.npy", harm)\n'
    ),
    "word_combat_only_in_a_message": (
        'print("combat harmonisation skipped")\n'
        "cross_val_score(LogisticRegression(), vol, dx_group, groups=subj, "
        "cv=GroupKFold(5))\n"
    ),
    "apply_a_model_learned_elsewhere": (
        "import pickle\nfrom neuroHarmonize import harmonizationApply\n"
        'model = pickle.load(open("harmonizer_from_training_run.pkl", "rb"))\n'
        "vol_h = harmonizationApply(vol, tab, model)\n"
        "parts = train_test_split(vol_h, dx_group)\n"
    ),
    "variable_named_like_combat": ("combat_free = vol.copy()\nparts = train_test_split(combat_free, dx_group)\n"),
}


@pytest.mark.parametrize("name", sorted(HARM_LEAKS))
def test_harmonisation_on_all_rows_before_split_is_red(name: str) -> None:
    rep = audit_source(_ROI_HEAD + HARM_LEAKS[name])
    hits = [f for f in rep["findings"] if f["code"] == "R2.harmonise_before_split"]
    assert hits and all(f["severity"] == "red" for f in hits), rep["findings"]
    assert "ComBat" in hits[0]["message"] and "training" in hits[0]["fix"]


@pytest.mark.parametrize("name", sorted(HARM_CLEAN))
def test_harmonisation_learned_on_train_part_passes(name: str) -> None:
    rep = audit_source(_ROI_HEAD + HARM_CLEAN[name])
    assert not [f for f in rep["findings"] if f["rule"] == "R2"], rep["findings"]
