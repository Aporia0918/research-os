"""Leak audit, rules after blind cases 3/4 (continued from test_leak_audit_flow.py): imputation / reduction /
augmentation of all rows, rows copied before the split, joined parts split again. Generic synthetic snippets;
parsed, never executed."""

from __future__ import annotations

import pytest

from researchos.services.verification.script_audit import audit_source

from .test_leak_audit_flow import _ECG_HEAD

# Imputation / dimensionality reduction fitted on all rows before the split (ADR-284): red; augmentation: yellow.
_CV = "from sklearn.model_selection import cross_val_score, StratifiedKFold\n"
REDUCE_LEAKS = {  # name -> (body after _ECG_HEAD, expected code)
    "simple_imputer_on_all_beats": (
        "from sklearn.impute import SimpleImputer\n"
        "X = SimpleImputer(strategy='median').fit_transform(X)\n"
        "a, b, c, d = train_test_split(X, y)\n",
        "R2.impute_before_split",
    ),
    "knn_imputer_fit_then_transform": (
        _CV + "from sklearn.impute import KNNImputer\nimp = KNNImputer(n_neighbors=5)\n"
        "imp.fit(X)\nX_f = imp.transform(X)\ncross_val_score(M(), X_f, y, cv=5)\n",
        "R2.impute_before_split",
    ),
    "pandas_fillna_with_column_means": (
        "beats = beats.fillna(beats.mean())\nX2 = beats.filter(like='lead').values\nparts = train_test_split(X2, y)\n",
        "R2.impute_before_split",
    ),
    "pca_on_all_beats": (
        "from sklearn.decomposition import PCA\nZ = PCA(n_components=12).fit_transform(X)\n"
        "parts = train_test_split(Z, y)\n",
        "R2.reduce_before_split",
    ),
    "umap_embedding_then_cv": (
        _CV + "import umap\nemb = umap.UMAP(n_components=8).fit_transform(X)\n"
        "cross_val_score(M(), emb, y, cv=StratifiedKFold(5))\n",
        "R2.reduce_before_split",
    ),
    "tsne_then_split": (
        "from sklearn.manifold import TSNE\nZ2 = TSNE(n_components=2).fit_transform(X)\n"
        "parts = train_test_split(Z2, y, stratify=y)\n",
        "R2.reduce_before_split",
    ),
    "truncated_svd_on_clinical_notes": (
        "from sklearn.feature_extraction.text import TfidfVectorizer\n"
        "from sklearn.decomposition import TruncatedSVD\n"
        "notes = pd.read_csv('discharge_notes.csv')\n"
        "tf = TfidfVectorizer().fit_transform(notes['text'])\n"
        "lsa = TruncatedSVD(100).fit_transform(tf)\n"
        "parts = train_test_split(lsa, notes['readmitted'])\n",
        "R2.reduce_before_split",
    ),
}
REDUCE_CLEAN = {
    "imputer_in_pipeline": (
        _CV + "from sklearn.impute import SimpleImputer\nfrom sklearn.pipeline import "
        "make_pipeline\ncross_val_score(make_pipeline(SimpleImputer(), M()), X, y, "
        "cv=StratifiedKFold(5))\n"
    ),
    "pca_fit_on_train_part": (
        "from sklearn.decomposition import PCA\n"
        "X_train, X_test, y_train, y_test = train_test_split(X, y)\n"
        "pca = PCA(10).fit(X_train)\nZ_test = pca.transform(X_test)\n"
    ),
    "fillna_with_a_constant": (
        "beats = beats.fillna(0)\nparts = train_test_split(beats.filter(like='lead').values, y)\n"
    ),
    "fillna_with_training_means": (
        "X_train, X_test = train_test_split(beats)\nX_test = X_test.fillna(X_train.mean())\n"
    ),
    "tsne_for_a_plot_only": (
        "from sklearn.manifold import TSNE\nZ2 = TSNE(2).fit_transform(X)\n"
        "plt.scatter(Z2[:, 0], Z2[:, 1])\nparts = train_test_split(X, y)\n"
    ),
    "umap_inside_fold_on_train": (
        _CV + "import umap\nfor tr, te in StratifiedKFold(5).split(X, y):\n"
        "    red = umap.UMAP().fit(X[tr])\n    M().fit(red.transform(X[tr]), y[tr])\n"
    ),
}
AUG_LEAKS = {
    "tsaug_on_all_ecg": "import tsaug\nX_aug = tsaug.TimeWarp().augment(X)\nparts = train_test_split(X_aug, y)\n",
    "own_add_noise_helper": (
        _CV + "X_noisy = add_noise(X, sigma=0.01)\ncross_val_score(M(), X_noisy, y, cv=StratifiedKFold(5))\n"
    ),
    "nlpaug_on_all_notes": (
        "import nlpaug.augmenter.word as naw\nnotes = pd.read_csv('notes.csv')\n"
        "aug_text = naw.SynonymAug().augment(list(notes['text']))\n"
        "parts = train_test_split(aug_text, notes['label'])\n"
    ),
    "jitter_then_fold_loop": (
        _CV + "Xj = jitter(X)\nfor tr, te in StratifiedKFold(5).split(Xj, y):\n    M().fit(Xj[tr], y[tr])\n"
    ),
    "mixup_on_all_rows": "Xm, ym = mixup(X, y, alpha=0.2)\nparts = train_test_split(Xm, ym)\n",
    "audiomentations_per_waveform": (
        "from audiomentations import Compose, AddGaussianNoise\n"
        "aug = Compose([AddGaussianNoise()])\n"
        "waves = np.stack([aug(samples=w, sample_rate=500) for w in X])\n"
        "parts = train_test_split(waves, y)\n"
    ),
}
AUG_CLEAN = {
    "augment_only_the_training_part": (
        "X_train, X_test, y_train, y_test = train_test_split(X, y)\nX_train_aug = jitter(X_train)\n"
    ),
    "augment_inside_fold_train": (
        _CV + "for tr, te in StratifiedKFold(5).split(X, y):\n    M().fit(add_noise(X[tr]), y[tr])\n"
    ),
    "augmented_but_never_split": "X_aug = jitter(X)\nnp.save('aug.npy', X_aug)\n",
    "transforms_defined_not_applied": (
        "from torchvision import transforms\n"
        "tf = transforms.Compose([transforms.RandomCrop(32)])\n"
        "parts = train_test_split(X, y)\n"
    ),
    "augment_word_in_a_flag": "use_augment = False\nparts = train_test_split(X, y)\n",
    "augmentation_passed_to_a_training_dataset": (
        "X_train, X_test, y_train, y_test = train_test_split(X, y)\n"
        "train_ds = BeatDataset(X_train, y_train, transform=jitter)\n"
    ),
}


@pytest.mark.parametrize("name", sorted(REDUCE_LEAKS))
def test_imputer_or_reducer_fitted_on_all_rows_before_split_is_red(name: str) -> None:
    body, code = REDUCE_LEAKS[name]
    rep = audit_source(_ECG_HEAD + body)
    hits = [f for f in rep["findings"] if f["code"] == code]
    assert hits and all(f["severity"] == "red" for f in hits), rep["findings"]
    assert not [f for f in rep["findings"] if f["code"] == "R2.before_split"]  # the specific text replaces it


@pytest.mark.parametrize("name", sorted(REDUCE_CLEAN))
def test_imputer_or_reducer_on_train_part_or_unsplit_passes(name: str) -> None:
    rep = audit_source(_ECG_HEAD + REDUCE_CLEAN[name])
    assert not [f for f in rep["findings"] if f["rule"] == "R2"], rep["findings"]


@pytest.mark.parametrize("name", sorted(AUG_LEAKS))
def test_augmentation_of_all_rows_before_split_is_yellow(name: str) -> None:
    rep = audit_source(_ECG_HEAD + AUG_LEAKS[name])
    hits = [f for f in rep["findings"] if f["code"] == "R2.augment_before_split"]
    assert hits and all(f["severity"] == "yellow" for f in hits), rep["findings"]
    assert "augment" in hits[0]["message"]


@pytest.mark.parametrize("name", sorted(AUG_CLEAN))
def test_augmentation_of_training_part_passes(name: str) -> None:
    rep = audit_source(_ECG_HEAD + AUG_CLEAN[name])
    assert not [f for f in rep["findings"] if f["rule"] == "R2"], rep["findings"]


# Rows copied / appended before a random split (ADR-285): red R5.duplicated_before_split.
_KF = "from sklearn.model_selection import KFold, GroupKFold, cross_val_score\ng = beats['patient'].values\n"
DUP_LEAKS = {
    "vstack_copies_of_some_rows": (
        "idx = np.where(y == 1)[0]\nX2 = np.vstack((X, X[idx]))\n"
        "y2 = np.concatenate((y, y[idx]))\nparts = train_test_split(X2, y2)\n"
    ),
    "pandas_concat_with_a_sample": (
        "ward = pd.read_csv('ward_admissions.csv')\n"
        "ward = pd.concat([ward, ward.sample(frac=0.3, random_state=1)], "
        "ignore_index=True)\ntr, te = train_test_split(ward, test_size=0.2)\n"
    ),
    "repeat_rows_axis0": "X3 = np.repeat(X, 3, axis=0)\ny3 = np.repeat(y, 3)\nparts = train_test_split(X3, y3)\n",
    "tile_rows": (
        _KF + "Xt = np.tile(X, (2, 1))\nyt = np.tile(y, 2)\ncross_val_score(M(), Xt, yt, cv=KFold(5, shuffle=True))\n"
    ),
    "bootstrap_whole_table": (
        "boot = beats.sample(n=5000, replace=True, random_state=0)\nparts = train_test_split(boot, test_size=0.25)\n"
    ),
    "append_noisy_copies_then_kfold": (
        _KF + "X_more = np.concatenate([X, X + 0.01 * np.random.randn(*X.shape)])\n"
        "for tr, te in KFold(5, shuffle=True).split(X_more):\n"
        "    M().fit(X_more[tr], y[tr])\n"
    ),
    "index_repeat_by_weight": (
        "beats = beats.loc[beats.index.repeat(beats['weight'])]\nparts = train_test_split(beats, test_size=0.2)\n"
    ),
}
DUP_CLEAN = {
    "copies_but_group_split": (
        _KF + "idx = np.where(y == 1)[0]\nX2 = np.vstack((X, X[idx]))\n"
        "y2 = np.concatenate((y, y[idx]))\ng2 = np.concatenate((g, g[idx]))\n"
        "for tr, te in GroupKFold(5).split(X2, y2, g2):\n    M().fit(X2[tr], y2[tr])\n"
    ),
    "partition_reordered_not_copied": (
        "X_sorted = np.vstack([X[y == 0], X[y == 1]])\nparts = train_test_split(X_sorted, np.sort(y))\n"
    ),
    "columns_concatenated_axis1": "X_wide = np.concatenate([X, X ** 2], axis=1)\nparts = train_test_split(X_wide, y)\n",
    "labels_repeated_per_window": "y_win = np.repeat(y, 10)\nparts = train_test_split(X_win, y_win)\n",
    "copies_of_the_training_part_only": (
        "X_train, X_test, y_train, y_test = train_test_split(X, y)\n"
        "X_train = np.vstack((X_train, X_train[y_train == 1]))\n"
    ),
    "two_different_tables_appended": (
        "extra = pd.read_csv('ecg_beats_site2.csv')\n"
        "all_beats = pd.concat([beats, extra])\n"
        "parts = train_test_split(all_beats, test_size=0.2)\n"
    ),
    "shuffle_with_sample_frac_1": (
        "beats = beats.sample(frac=1.0, random_state=0)\nparts = train_test_split(beats, test_size=0.2)\n"
    ),
}


@pytest.mark.parametrize("name", sorted(DUP_LEAKS))
def test_rows_copied_before_a_random_split_are_red(name: str) -> None:
    rep = audit_source(_ECG_HEAD + DUP_LEAKS[name])
    hits = [f for f in rep["findings"] if f["code"] == "R5.duplicated_before_split"]
    assert hits and all(f["severity"] == "red" for f in hits), rep["findings"]
    assert "copies" in hits[0]["message"] and "after the split" in hits[0]["fix"]


@pytest.mark.parametrize("name", sorted(DUP_CLEAN))
def test_rows_copied_after_split_or_split_by_group_pass(name: str) -> None:
    rep = audit_source(_ECG_HEAD + DUP_CLEAN[name])
    assert not [f for f in rep["findings"] if f["rule"] == "R5"], rep["findings"]


# Train / validation / test parts joined and then split again (ADR-286): yellow R1.resplit_joined_parts.
_SPLITS = "from sklearn.model_selection import KFold, GroupKFold, ShuffleSplit\n"
RESPLIT_LEAKS = {
    "id_lists_added_then_row_split": (
        "pids = beats['patient'].unique()\n"
        "train_ids, val_ids = train_test_split(pids, test_size=0.2)\n"
        "all_ids = train_ids.tolist() + val_ids.tolist()\n"
        "rows = beats[beats['patient'].isin(all_ids)]\n"
        "tr_rows, va_rows = train_test_split(rows, test_size=0.2)\n"
    ),
    "tables_concatenated_then_kfold": (
        _SPLITS + "train_df = pd.read_csv('split/train.tsv', sep='\\t')\n"
        "valid_df = pd.read_csv('split/valid.tsv', sep='\\t')\n"
        "pool = pd.concat([train_df, valid_df])\n"
        "for a, b in KFold(5, shuffle=True).split(pool):\n    print(len(a))\n"
    ),
    "id_arrays_hstacked": (
        "train_subjects = np.load('train_subjects.npy')\n"
        "test_subjects = np.load('test_subjects.npy')\n"
        "every = np.hstack([train_subjects, test_subjects])\n"
        "new_tr, new_te = train_test_split(every, test_size=0.3)\n"
    ),
    "list_extend_then_shuffle_split": (
        _SPLITS + "train_list = list(open('train.txt'))\n"
        "dev_list = list(open('dev.txt'))\ntrain_list.extend(dev_list)\n"
        "folds = ShuffleSplit(5).split(train_list)\n"
    ),
    "set_union_of_sessions": (
        "train_sessions = set(beats.loc[beats.part == 'a', 'session'])\n"
        "holdout_sessions = set(beats.loc[beats.part == 'b', 'session'])\n"
        "pool = train_sessions | holdout_sessions\n"
        "parts = train_test_split(sorted(pool), test_size=0.25)\n"
    ),
    "text_corpus_train_plus_test": (
        "train_texts, test_texts = load_split('train'), load_split('test')\n"
        "corpus = train_texts + test_texts\nlabels = train_labels + test_labels\n"
        "x_a, x_b, y_a, y_b = train_test_split(corpus, labels, test_size=0.2)\n"
    ),
}
RESPLIT_CLEAN = {
    "train_plus_val_for_final_refit": (
        "X_trainval = np.concatenate([X_train, X_val])\n"
        "y_trainval = np.concatenate([y_train, y_val])\n"
        "final = M().fit(X_trainval, y_trainval)\n"
    ),
    "joined_then_group_split": (
        _SPLITS + "pool = pd.concat([train_df, valid_df])\n"
        "for a, b in GroupKFold(5).split(pool, groups=pool['patient']):\n    print(a)\n"
    ),
    "two_training_chunks_joined": (
        "X_train = np.concatenate([X_train_a, X_train_b])\nparts = train_test_split(X_train, y_train)\n"
    ),
    "test_predictions_joined_for_a_report": (
        "all_preds = np.concatenate([pred_test_a, pred_test_b])\nprint(all_preds.mean())\n"
    ),
    "parts_joined_never_split_again": (
        "report = pd.concat([train_df.assign(part='train'), "
        "valid_df.assign(part='valid')])\nreport.to_csv('parts.csv')\n"
    ),
    "losses_added_not_ids": "total = train_loss + val_loss\nprint(total)\nparts = train_test_split(X, y)\n",
}


@pytest.mark.parametrize("name", sorted(RESPLIT_LEAKS))
def test_joined_train_and_validation_parts_split_again_is_yellow(name: str) -> None:
    rep = audit_source(_ECG_HEAD + RESPLIT_LEAKS[name])
    hits = [f for f in rep["findings"] if f["code"] == "R1.resplit_joined_parts"]
    assert hits and all(f["severity"] == "yellow" for f in hits), rep["findings"]
    assert "joined" in hits[0]["message"] and "subject" in hits[0]["fix"]


@pytest.mark.parametrize("name", sorted(RESPLIT_CLEAN))
def test_joined_parts_refit_or_group_split_pass(name: str) -> None:
    rep = audit_source(_ECG_HEAD + RESPLIT_CLEAN[name])
    assert not [f for f in rep["findings"] if f["code"] == "R1.resplit_joined_parts"], rep["findings"]
