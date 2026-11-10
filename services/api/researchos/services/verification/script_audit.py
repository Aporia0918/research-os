"""Static leakage audit of a user's training script (H-01/F-06, ADR-271). Read-only: the file is parsed with `ast`,
never imported or executed. Rules (heuristics; see ADR-271 for known misses):
  R1 random split (train_test_split / KFold / ShuffleSplit / default cv) although rows carry a subject or session;
     Keras `validation_split=` on rows that share subjects (yellow);
  R2 StandardScaler / SelectKBest / PCA / SMOTE ... fitted before the split, on test data, or outside a Pipeline
     on data that is not clearly the training part; hand-written `(X - X.mean(0)) / X.std(0)`, `X / X.max()` ...
     with statistics of the whole array on data that is then split; fitted on all rows and then split / CV'd
     (script_fitall.py): feature selection, target scaling, confound regression, ComBat, imputers, reducers,
     augmentation (yellow); joined train + val parts split again without groups (R1, yellow; script_rows.py);
  R3 random or generated numbers assigned to X / y while no file is read anywhere;
  R4 the test set used for tuning: search.fit, early stopping / eval sets, or a fit-and-score loop;
  R5 oversampling / undersampling (imblearn fit_resample, smote_variants .sample, sklearn.utils.resample with
     replacement) of data that is later split or cross-validated, or of the test part; rows copied / appended
     before a group-blind split (script_rows.py);
  PARSE lines Python rejects are skipped (yellow) and the rest is audited.
Each finding has a stable `code` (texts are English here; the codes are the translation keys), a line and a fix."""

from __future__ import annotations

import ast
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from .script_fitall import TEXT as FITALL_TEXT
from .script_fitall import YELLOW as FITALL_YELLOW
from .script_fitall import fitted_on_all
from .script_flow import r2_manual, r5
from .script_rows import TEXT as ROWS_TEXT
from .script_rows import YELLOW as ROWS_YELLOW
from .script_rows import copied_rows
from .script_source import (
    Source,
    SourceError,
    dotted,
    import_aliases,
    last,
    load_path,
    names_in,
    notebook_source,
    parse,
)

RANDOM_SPLITTERS = {
    "KFold",
    "StratifiedKFold",
    "ShuffleSplit",
    "StratifiedShuffleSplit",
    "RepeatedKFold",
    "RepeatedStratifiedKFold",
    "LeaveOneOut",
    "LeavePOut",
}
GROUP_SPLITTERS = {
    "GroupKFold",
    "GroupShuffleSplit",
    "LeaveOneGroupOut",
    "LeavePGroupsOut",
    "StratifiedGroupKFold",
    "PredefinedSplit",
    "TimeSeriesSplit",
}
CV_FUNCS = {
    "cross_val_score",
    "cross_validate",
    "cross_val_predict",
    "learning_curve",
    "validation_curve",
    "permutation_test_score",
}
SEARCHES = {"GridSearchCV", "RandomizedSearchCV", "HalvingGridSearchCV", "HalvingRandomSearchCV", "BayesSearchCV"}
PREPROC = {
    "StandardScaler",
    "MinMaxScaler",
    "RobustScaler",
    "MaxAbsScaler",
    "SelectKBest",
    "SelectPercentile",
    "RFE",
    "PCA",
    "FastICA",
}
FIT_METHODS = {"fit", "fit_transform", "fit_resample"}
ALL_SPLITTERS = RANDOM_SPLITTERS | GROUP_SPLITTERS
SORTS = {"sort_values", "sort_index", "argsort", "lexsort", "sort", "sorted"}
EVAL_CALLS = {
    "score",
    "predict",
    "predict_proba",
    "evaluate",
    "accuracy_score",
    "f1_score",
    "roc_auc_score",
    "balanced_accuracy_score",
    "precision_score",
    "recall_score",
}
EARLY_STOP_KW = {"eval_set", "validation_data", "valid_sets", "eval_X", "X_val"}
RNG_FACTORIES = {"default_rng", "RandomState", "Generator"}
TORCH_RANDOM = {"rand", "randn", "randint", "normal", "rand_like", "randn_like"}
NOT_FAKE = {"seed", "permutation", "shuffle", "choice", "default_rng", "RandomState", "get_state", "set_state"}
READ_EXACT = {"open", "load", "loadtxt", "genfromtxt", "fromfile", "loadmat", "File", "imread", "memmap"}
READ_PREFIX = ("read_", "load_", "fetch_", "loadmat")
DATA_NAME = re.compile(r"^(x|y|data|dataset|features?|labels?|targets?|signals?|eeg|inputs?|samples?)(_\w*)?$", re.I)
SUBJECT = re.compile(r"(^|[_\W])(subject|subj|participant|patient|person|session)s?(_?ids?)?($|[_\W])|^sub$", re.I)

RULES = {
    "R1": "random split while rows share a subject or session",
    "R2": "preprocessing fitted on data outside the training part",
    "R3": "random or generated data instead of real files",
    "R4": "test set used for tuning or early stopping",
    "R5": "oversampling or undersampling before the split",
    "PARSE": "lines Python could not parse (skipped, the rest was audited)",
}
TEXT: dict[str, tuple[str, str]] = {  # code -> (what is wrong, one-sentence fix)
    "R1.random_split": (
        "rows are split at random, so the same subject can be in both training and test data",
        "Split by subject: use GroupShuffleSplit/GroupKFold with groups=<subject column>, or split "
        "the list of subject IDs first.",
    ),
    "R1.random_cv": (
        "this cross-validation splitter ignores subjects, so folds mix the same person's data",
        "Use GroupKFold (or StratifiedGroupKFold) and pass groups=<subject column> to split()/fit().",
    ),
    "R1.default_cv": (
        "cv is a number or missing, which means plain K-fold that ignores subjects",
        "Pass cv=GroupKFold(n) and groups=<subject column> so each subject stays in one fold.",
    ),
    "R1.validation_split": (
        "validation_split ignores subjects: Keras takes the last rows of the arrays as they are "
        "(not shuffled first) and other tools sample from the pooled rows, so the same subject "
        "is usually in both the training and the validation part",
        "Make the validation part yourself by subject (e.g. GroupShuffleSplit on the training "
        "part) and pass validation_data=(X_val, y_val) instead of validation_split.",
    ),
    "R2.before_split": (
        "this is fitted on all the data before it is split, so test statistics leak into training",
        "Put the step inside a Pipeline (make_pipeline(step, model)) and fit it on the training part only.",
    ),
    "R2.manual_stats_before_split": (
        "the data are standardised or normalised by hand with statistics (mean, std, "
        "max, ...) of the whole array before it is split, so the test rows shape the "
        "training data",
        "Compute the statistics on the training part only (e.g. "
        "mu = X_train.mean(0)) and apply them to both parts, or use "
        "StandardScaler inside a Pipeline.",
    ),
    "R2.fit_on_test": (
        "this is fitted on test data",
        "Fit it on the training part only and use .transform() on the test part.",
    ),
    "R2.outside_pipeline": (
        "this is fitted outside a Pipeline on data that is not clearly the training part",
        "Wrap the step and the model in a Pipeline so cross-validation refits it inside each training fold.",
    ),
    "R3.fake_data": (
        "X/y are filled with random or generated numbers and no data file is read anywhere",
        "Load the real recordings (e.g. pd.read_csv / mne.io.read_raw_*) or label this clearly as "
        "a simulation; results on random data mean nothing.",
    ),
    "R4.search_on_test": (
        "the hyper-parameter search is fitted on the test set",
        "Fit the search on the training part; touch the test set once, at the very end.",
    ),
    "R4.early_stop_on_test": (
        "the test set is used as the early-stopping / evaluation set",
        "Hold out a separate validation part of the training data for early stopping.",
    ),
    "R4.test_in_loop": (
        "the test score is checked inside a loop that refits models, i.e. the test set picks the setting",
        "Choose settings with cross-validation on the training part; evaluate the test set once after choosing.",
    ),
    "R5.before_split": (
        "the data are oversampled or undersampled (SMOTE-type or copied rows) before they are split "
        "or cross-validated, so new rows made from test rows end up in training and the test score "
        "is inflated",
        "Resample only the training part after the split, or put the sampler inside "
        "an imblearn Pipeline so cross-validation resamples each training fold only.",
    ),
    "R5.on_test": (
        "the test part is resampled, so it is scored on synthetic or duplicated rows",
        "Leave the test part as it is; resample only the training part.",
    ),
}


TEXT.update(FITALL_TEXT | ROWS_TEXT)


class _Ctx:
    """Facts about the whole script that the rules share."""

    def __init__(self, tree: ast.Module, subject_columns: Iterable[str]) -> None:
        self.tree, self.aliases = tree, import_aliases(tree)
        self.calls = sorted(
            (n for n in ast.walk(tree) if isinstance(n, ast.Call)), key=lambda n: (n.lineno, n.col_offset)
        )
        self.bound: dict[str, list[tuple[int, str]]] = {}  # var -> [(line, constructor/factory dotted origin)]
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
                kind = dotted(node.value.func, self.aliases) or ""
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        self.bound.setdefault(t.id, []).append((node.lineno, kind))
        self.fold_train, self.fold_test, self.fold_loops = self._fold_names()
        self.subject = self._subject_evidence(subject_columns)
        self.first_split = min((c.lineno for c in self.calls if self._is_split(c)), default=None)

    def kind_of(self, node: ast.AST, line: int) -> str:
        """Class / factory behind an expression: a constructor call, or the latest binding of a variable."""
        return last(self.origin_of(node, line))

    def origin_of(self, node: ast.AST, line: int) -> str:
        """Like kind_of, but the full dotted origin (`smote_variants.SMOTE`)."""
        if isinstance(node, ast.Call):
            return dotted(node.func, self.aliases) or ""
        if isinstance(node, ast.Name):
            seen = [k for ln, k in self.bound.get(node.id, []) if ln <= line]
            return seen[-1] if seen else ""
        return ""

    def _fold_names(self) -> tuple[set[str], set[str], set[int]]:
        train, test, loops = set(), set(), set()
        for node in ast.walk(self.tree):
            if (
                isinstance(node, ast.For)
                and isinstance(node.iter, ast.Call)
                and isinstance(node.iter.func, ast.Attribute)
                and node.iter.func.attr == "split"
                and isinstance(node.target, ast.Tuple)
                and len(node.target.elts) == 2
            ):
                a, b = node.target.elts
                train |= {a.id} if isinstance(a, ast.Name) else set()
                test |= {b.id} if isinstance(b, ast.Name) else set()
                loops.add(id(node))
        return train, test, loops

    def _subject_evidence(self, columns: Iterable[str]) -> dict[str, Any] | None:
        for c in columns:
            if c:
                return {"source": "data", "token": c, "line": None}
        for node in ast.walk(self.tree):
            for tok in names_in(node) if isinstance(node, (ast.Name, ast.Constant, ast.Attribute)) else []:
                if SUBJECT.search(tok):
                    return {"source": "script", "token": tok[:60], "line": getattr(node, "lineno", None)}
        return None

    def _is_split(self, c: ast.Call) -> bool:
        name = last(dotted(c.func, self.aliases))
        if name in {"train_test_split", "random_split"} | CV_FUNCS:
            return True
        if isinstance(c.func, ast.Attribute) and c.func.attr == "split" and c.args:
            return True
        return (
            isinstance(c.func, ast.Attribute)
            and c.func.attr == "fit"
            and self.kind_of(c.func.value, c.lineno) in SEARCHES
        )

    def is_split_like(self, c: ast.Call) -> bool:
        """A split, or any call handed a CV splitter (`evaluate(model, X, y, validator)`, `cv=...`)."""
        if self._is_split(c) or any(k.arg == "cv" for k in c.keywords):
            return True
        return any(self.kind_of(a, c.lineno) in ALL_SPLITTERS for a in [*c.args, *(k.value for k in c.keywords)])

    def is_train(self, node: ast.AST) -> bool:
        return any("train" in n.lower() or n in self.fold_train for n in names_in(node))

    def is_test(self, node: ast.AST) -> bool:
        ns = names_in(node)
        return not self.is_train(node) and any("test" in n.lower() or n in self.fold_test for n in ns)


def _finding(src: Source, code: str, severity: str, line: int) -> dict[str, Any]:
    what, fix = TEXT[code]
    return {
        "rule": code.split(".")[0],
        "code": code,
        "severity": severity,
        "line": line,
        **src.where(line),
        "snippet": src.snippet(line),
        "message": what,
        "fix": fix,
    }


def _skipped(src: Source, line: int, msg: str) -> dict[str, Any]:
    return {
        "rule": "PARSE",
        "code": "PARSE.skipped_line",
        "severity": "yellow",
        "line": line,
        **src.where(line),
        "snippet": src.snippet(line),
        "message": f"line {line} is not valid Python: {msg}; the audit continued on the parsable part",
        "fix": f"Fix line {line} or turn it into a # comment and audit again: anything that line did is "
        "missing from this audit.",
    }


def _r1(ctx: _Ctx) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    for c in ctx.calls:
        name = last(dotted(c.func, ctx.aliases))
        if name in RANDOM_SPLITTERS or name == "random_split":
            out.append(("R1.random_cv" if name in RANDOM_SPLITTERS else "R1.random_split", c.lineno))
        elif name == "train_test_split" and not any(SUBJECT.search(n) for a in c.args for n in names_in(a)):
            out.append(("R1.random_split", c.lineno))
        elif name in CV_FUNCS | SEARCHES and _default_cv(ctx, c):
            out.append(("R1.default_cv", c.lineno))
    if ctx.subject and not _ordered_by_subject(ctx):
        out += [("R1.validation_split", c.lineno) for c in ctx.calls if _uses_validation_split(c)]
    return out


def _uses_validation_split(c: ast.Call) -> bool:
    kw = {k.arg: k.value for k in c.keywords}
    vs = kw.get("validation_split")
    if vs is None or "validation_data" in kw:  # Keras ignores validation_split when validation_data is given
        return False
    return not (isinstance(vs, ast.Constant) and not vs.value)  # 0, 0.0, None: no validation part


def _ordered_by_subject(ctx: _Ctx) -> bool:
    """The rows were sorted by subject (`df.sort_values("subject")`, `np.argsort(groups)`), so the last rows that
    validation_split takes are whole subjects."""
    subj = {
        n.id
        for node in ast.walk(ctx.tree)
        if isinstance(node, ast.Assign) and any(SUBJECT.search(t) for t in names_in(node.value))
        for t in node.targets
        for n in ast.walk(t)
        if isinstance(n, ast.Name)
    }
    return any(
        last(dotted(c.func, ctx.aliases)) in SORTS
        and any(SUBJECT.search(n) or n in subj for a in [*c.args, *(k.value for k in c.keywords)] for n in names_in(a))
        for c in ctx.calls
    )


def _default_cv(ctx: _Ctx, c: ast.Call) -> bool:
    cv = next((k.value for k in c.keywords if k.arg == "cv"), None)
    if cv is None:
        return True
    if isinstance(cv, ast.Constant):
        return isinstance(cv.value, int) and not isinstance(cv.value, bool)
    return False  # a splitter object: judged where it is constructed


def _r2(ctx: _Ctx) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    for c in ctx.calls:
        if not (isinstance(c.func, ast.Attribute) and c.func.attr in FIT_METHODS):
            continue
        if ctx.kind_of(c.func.value, c.lineno) not in PREPROC or ctx.first_split is None:
            continue
        data = c.args[0] if c.args else next((k.value for k in c.keywords if k.arg == "X"), None)
        if c.lineno < ctx.first_split:
            out.append(("R2.before_split", c.lineno))
        elif data is not None and ctx.is_test(data):
            out.append(("R2.fit_on_test", c.lineno))
        elif data is None or not ctx.is_train(data):
            out.append(("R2.outside_pipeline", c.lineno))
    return out


def _is_random_source(ctx: _Ctx, c: ast.Call) -> bool:
    full = dotted(c.func, ctx.aliases) or ""
    name = last(full)
    if name in NOT_FAKE:
        return False
    if full.startswith(("numpy.random.", "random.")) or full.startswith("sklearn.datasets.make_"):
        return True
    if full.startswith("torch.") and name in TORCH_RANDOM:
        return True
    return isinstance(c.func, ast.Attribute) and ctx.kind_of(c.func.value, c.lineno) in RNG_FACTORIES


def _reads_files(ctx: _Ctx) -> bool:
    for c in ctx.calls:
        name = last(dotted(c.func, ctx.aliases))
        if name in READ_EXACT or name.startswith(READ_PREFIX):
            return True
    return False


def _r3(ctx: _Ctx) -> list[tuple[str, int]]:
    if _reads_files(ctx):
        return []
    out: list[tuple[str, int]] = []
    for node in ast.walk(ctx.tree):
        if not isinstance(node, ast.Assign):
            continue
        targets = [n.id for t in node.targets for n in ast.walk(t) if isinstance(n, ast.Name)]
        if any(DATA_NAME.match(t) for t in targets) and any(
            isinstance(n, ast.Call) and _is_random_source(ctx, n) for n in ast.walk(node.value)
        ):
            out.append(("R3.fake_data", node.lineno))
    return out


def _r4(ctx: _Ctx) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    for c in ctx.calls:
        f = c.func
        if (
            isinstance(f, ast.Attribute)
            and f.attr == "fit"
            and ctx.kind_of(f.value, c.lineno) in SEARCHES
            and any(ctx.is_test(a) for a in c.args)
        ):
            out.append(("R4.search_on_test", c.lineno))
        if any(k.arg in EARLY_STOP_KW and ctx.is_test(k.value) for k in c.keywords):
            out.append(("R4.early_stop_on_test", c.lineno))
    for loop in (n for n in ast.walk(ctx.tree) if isinstance(n, (ast.For, ast.While))):
        if id(loop) in ctx.fold_loops:
            continue
        inner = [n for b in loop.body for n in ast.walk(b) if isinstance(n, ast.Call)]
        fits = any(isinstance(n.func, ast.Attribute) and n.func.attr in FIT_METHODS for n in inner)
        evals = [
            n for n in inner if last(dotted(n.func, ctx.aliases)) in EVAL_CALLS and any(ctx.is_test(a) for a in n.args)
        ]
        if fits and evals:
            out.append(("R4.test_in_loop", evals[0].lineno))
    return out


def _severity(code: str, ctx: _Ctx) -> str:
    if code == "R1.validation_split" or code in FITALL_YELLOW | ROWS_YELLOW:
        return "yellow"  # depends on the row order, which the script alone does not show
    if code.startswith("R1"):
        return "red" if ctx.subject else "yellow"
    return "red" if code.startswith(("R2", "R5")) else "yellow"


def _status(severities: Iterable[str]) -> str:
    s = set(severities)
    return "red" if "red" in s else "yellow" if "yellow" in s else "green"


def audit(src: Source, subject_columns: Iterable[str] = ()) -> dict[str, Any]:
    """Report: overall status, per-rule red/yellow/green rows, findings sorted by line. Lines Python rejects are
    skipped and reported (PARSE.skipped_line, yellow); a file that still cannot be parsed is status `error` (never a
    silent green)."""
    base: dict[str, Any] = {"file": src.filename, "notebook": bool(src.cells), "executed": False}
    try:
        ctx = _Ctx(parse(src), subject_columns)
    except SourceError as e:
        return {
            **base,
            "status": "error",
            "error": {"code": e.code, "message": str(e), "line": e.line},
            "rules": [],
            "findings": [],
        }
    raw = {
        (code, line)
        for rule in (_r1, _r2, r2_manual, _r3, _r4, r5, fitted_on_all, copied_rows)
        for code, line in rule(ctx)
    }
    specific = {line for code, line in raw if code.startswith("R2.") and code in FITALL_TEXT}
    raw -= {("R2.before_split", line) for line in specific}  # SelectKBest / PCA: the specific text wins
    findings = sorted(
        [
            *(_finding(src, code, _severity(code, ctx), line) for code, line in raw),
            *(_skipped(src, line, msg) for line, msg in src.skipped),
        ],
        key=lambda f: (f["line"], f["code"]),
    )
    rules = [
        {"rule": r, "title": t, "status": _status(f["severity"] for f in findings if f["rule"] == r)}
        for r, t in RULES.items()
    ]
    return {
        **base,
        "status": _status(f["severity"] for f in findings),
        "rules": rules,
        "findings": findings,
        "subject_evidence": ctx.subject,
        "first_split_line": ctx.first_split,
        "reads_files": _reads_files(ctx),
        "skipped_lines": [line for line, _ in src.skipped],
    }


def audit_source(text: str, *, filename: str = "script.py", subject_columns: Iterable[str] = ()) -> dict[str, Any]:
    return audit(Source(text, filename), subject_columns)


def audit_notebook(
    raw: str, *, filename: str = "notebook.ipynb", subject_columns: Iterable[str] = ()
) -> dict[str, Any]:
    try:
        src = notebook_source(raw, filename)
    except SourceError as e:
        return {
            "file": filename,
            "notebook": True,
            "executed": False,
            "status": "error",
            "rules": [],
            "findings": [],
            "error": {"code": e.code, "message": str(e), "line": None},
        }
    return audit(src, subject_columns)


def audit_file(path: Path, subject_columns: Iterable[str] = ()) -> dict[str, Any]:
    try:
        src = load_path(path)
    except SourceError as e:
        return {
            "file": path.name,
            "notebook": path.suffix.lower() == ".ipynb",
            "executed": False,
            "status": "error",
            "rules": [],
            "findings": [],
            "error": {"code": e.code, "message": str(e), "line": None},
        }
    return audit(src, subject_columns)
