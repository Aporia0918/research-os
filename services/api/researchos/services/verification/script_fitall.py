"""Script-audit rules "fitted on all samples before the split / CV" (ADR-280..): a step that learns from every row
(feature selection, ...) produces names; if those names, followed through later assignments in line order, reach a
split-like call or the body of a CV fold loop, the step saw the test rows. One data-flow engine, one detector per
kind of step. Data that is a train / test part (by name, or the fold's indices) is never "all rows"."""

from __future__ import annotations

import ast
import re
from collections.abc import Callable, Iterator
from typing import TYPE_CHECKING

from .script_flow import assign_pairs, is_target, leaky_axis, target_names, whole_stat
from .script_source import dotted, last

if TYPE_CHECKING:
    from .script_audit import _Ctx as Ctx

SELECTORS = {
    "SelectKBest",
    "SelectPercentile",
    "SelectFpr",
    "SelectFdr",
    "SelectFwe",
    "GenericUnivariateSelect",
    "RFE",
    "RFECV",
    "SelectFromModel",
    "SequentialFeatureSelector",
    "VarianceThreshold",
}
SCORE_FUNCS = {"f_classif", "f_regression", "r_regression", "chi2", "mutual_info_classif", "mutual_info_regression"}
STAT_TESTS = {
    "pearsonr",
    "spearmanr",
    "kendalltau",
    "pointbiserialr",
    "ttest_ind",
    "mannwhitneyu",
    "ranksums",
    "f_oneway",
    "kruskal",
    "corrcoef",
    "corrwith",
}
COEF_ATTRS = {"coef_", "feature_importances_", "support_", "ranking_", "scores_", "pvalues_", "get_support"}
FITS = {"fit", "fit_transform"}
CONFOUND = re.compile(
    r"confound|covar|nuisance|(?<![a-z])(age|sex|gender|site|scanner|motion|batch|e?tiv|icv|"
    r"handedness)(?![a-z])",
    re.I,
)
HARMONISERS = re.compile(r"^(neuro|py)?combat$|combat_?model|harmoni[sz]ation_?learn|^harmoni[sz]e$", re.I)
REDUCERS = {
    "PCA",
    "IncrementalPCA",
    "KernelPCA",
    "SparsePCA",
    "TruncatedSVD",
    "FastICA",
    "NMF",
    "FactorAnalysis",
    "LatentDirichletAllocation",
    "UMAP",
    "TSNE",
    "Isomap",
    "LocallyLinearEmbedding",
    "MDS",
    "SpectralEmbedding",
}
IMPUTERS = {"SimpleImputer", "KNNImputer", "IterativeImputer"}
AUGMENT = re.compile(
    r"augment|mixup|cutmix|jitter|time_?warp|magnitude_?warp|window_?(slice|warp)|add_?(gaussian_?)?"
    r"noise|random_?(crop|flip|rotat|shift|scal|erasing)",
    re.I,
)
AUG_MODULES = ("tsaug.", "audiomentations.", "albumentations.", "nlpaug.", "imgaug.", "augly.")
YELLOW = {"R2.augment_before_split"}  # the copies may be harmless; the script alone does not show it
RESIDUALS = {"resid", "resid_response", "resid_pearson", "resid_deviance", "resid_working"}
SCALERS = {
    "StandardScaler",
    "MinMaxScaler",
    "RobustScaler",
    "MaxAbsScaler",
    "QuantileTransformer",
    "PowerTransformer",
    "KBinsDiscretizer",
}
SCALE_FUNCS = {"scale", "minmax_scale", "robust_scale", "maxabs_scale", "quantile_transform", "power_transform"}
ZSCORE = re.compile(r"^(z_?score|standardi[sz]e)$", re.I)  # also a script's own helper of that name

TEXT: dict[str, tuple[str, str]] = {
    "R2.target_before_split": (
        "the labels / target values are scaled or transformed with statistics of all rows "
        "(z-score, quantile or power transform) before the split, so the test labels shape "
        "the training labels",
        "Fit the transform on the training labels only (y_train) and "
        "apply it to the test labels, or use "
        "TransformedTargetRegressor so CV refits it per fold.",
    ),
    "R2.confound_before_split": (
        "confounds / covariates (age, sex, site, motion, ...) are regressed out with a "
        "regression fitted on all rows before the split or cross-validation, so the test "
        "rows shape the corrected training data",
        "Fit the confound regression on the "
        "training part only and apply its coefficients to the test part (inside each CV "
        "fold), e.g. a ConfoundRegressor step in a Pipeline.",
    ),
    "R2.harmonise_before_split": (
        "site / scanner / batch effects are harmonised (ComBat-type) with all rows before "
        "the split or cross-validation, so the test rows shape the site corrections "
        "applied to the training data",
        "Learn the harmonisation on the training part "
        "only (e.g. harmonizationLearn on train, harmonizationApply on test) inside each "
        "fold.",
    ),
    "R2.impute_before_split": (
        "missing values are filled with statistics or neighbours learned from all rows "
        "before the split or cross-validation, so test rows shape the training data",
        "Fit the imputer on the training part only, e.g. make_pipeline(SimpleImputer(), "
        "model) inside cross-validation.",
    ),
    "R2.reduce_before_split": (
        "a dimensionality reduction / embedding (PCA, SVD, ICA, UMAP, t-SNE, ...) is fitted "
        "on all rows before the split or cross-validation, so the test rows shape the "
        "components the model is trained on",
        "Fit the reduction on the training part only "
        "(a Pipeline step); t-SNE has no transform for new rows, so use it for plots only.",
    ),
    "R2.augment_before_split": (
        "the data are augmented (noise, warping, synonyms, mixup, ...) before the split, so "
        "near-copies of test rows can end up in training",
        "Augment only the training part "
        "after the split (or inside each training fold); leave the test part as recorded.",
    ),
    "R2.select_before_split": (
        "features are selected with all rows, test labels included, before the split or "
        "cross-validation, so the selected features already fit the test rows",
        "Select inside each training fold only: put the selector in a Pipeline with the "
        "model (make_pipeline(SelectKBest(...), model)) or compute the scores / "
        "correlations on the training part.",
    ),
}

Event = tuple[str, ast.expr, ast.stmt, set[str]]  # code, the fitting call / expression, its statement, names made


def _ids(node: ast.AST, ctx: Ctx) -> set[str]:
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and n.id not in ctx.aliases}


def targets_of(st: ast.stmt) -> set[str]:
    if isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
        tg = st.targets if isinstance(st, ast.Assign) else [st.target]
        return {n.id for t in tg for n in ast.walk(t) if isinstance(n, ast.Name)}
    if (
        isinstance(st, ast.Expr)
        and isinstance(st.value, ast.Call)
        and isinstance(st.value.func, ast.Attribute)
        and isinstance(st.value.func.value, ast.Name)
    ):
        return {st.value.func.value.id}  # sel.fit(X, y), rows.append(...): the object now carries the data
    return set()


def full(ctx: Ctx, nodes: list[ast.expr]) -> bool:
    return bool(nodes) and not any(ctx.is_train(n) or ctx.is_test(n) for n in nodes)


def _data(c: ast.Call) -> list[ast.expr]:
    return [*c.args, *(k.value for k in c.keywords if k.arg in ("X", "y", "dat", "data"))]


class Flow:
    """Statements in line order, the script's fold loops and the statement holding each call."""

    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.parent = {id(ch): node for node in ast.walk(ctx.tree) for ch in ast.iter_child_nodes(node)}
        simple = (ast.Assign, ast.AugAssign, ast.AnnAssign, ast.Expr, ast.Return, ast.For)
        self.stmts = sorted((n for n in ast.walk(ctx.tree) if isinstance(n, simple)), key=lambda n: n.lineno)
        self.loops = [n for n in ast.walk(ctx.tree) if isinstance(n, ast.For) and id(n) in ctx.fold_loops]
        self.inside = {id(lp): {id(n) for b in lp.body for n in ast.walk(b)} for lp in self.loops}

    def stmt_of(self, node: ast.AST) -> ast.stmt:
        while not isinstance(node, ast.stmt):
            node = self.parent[id(node)]
        return node

    def in_loop(self, node: ast.AST) -> bool:
        """Inside a `for` loop or a comprehension (one recording at a time)."""
        while id(node) in self.parent:
            node = self.parent[id(node)]
            if isinstance(node, (ast.For, ast.comprehension, ast.ListComp, ast.GeneratorExp, ast.DictComp)):
                return True
        return False

    def random(self, c: ast.expr) -> bool:
        """A split that ignores groups: no `groups=`, no group splitter object, not `<group splitter>.split`."""
        ctx = self.ctx
        if not isinstance(c, ast.Call):
            return True
        if any(k.arg == "groups" for k in c.keywords) or any(
            ctx.kind_of(a, c.lineno) in GROUP_KINDS for a in [*c.args, *(k.value for k in c.keywords)]
        ):
            return False
        f = c.func
        return not (
            isinstance(f, ast.Attribute)
            and f.attr == "split"
            and (ctx.kind_of(f.value, c.lineno) in GROUP_KINDS or len(c.args) >= 3)
        )

    def reaches_split(self, call: ast.expr, st: ast.stmt, made: set[str], random_only: bool = False) -> bool:
        ctx = self.ctx
        ok = self.random if random_only else (lambda c: True)
        if any(
            ctx.is_split_like(c) and ok(c) and any(n is call for n in ast.walk(c))
            for c in ast.walk(st)
            if isinstance(c, ast.Call) and c is not call
        ):
            return True  # train_test_split(SelectKBest().fit_transform(X, y), y)
        if any(id(st) in self.inside[id(lp)] and ok(lp.iter) for lp in self.loops):
            return True  # fitted on all rows inside the CV loop itself
        tainted = set(made)
        for s in self.stmts:
            if s.lineno <= (st.end_lineno or st.lineno) or not tainted:
                continue
            head = s.iter if isinstance(s, ast.For) else s
            used = _ids(head, ctx) & tainted
            if used and any(
                isinstance(c, ast.Call) and ctx.is_split_like(c) and ok(c) and _ids(c, ctx) & tainted
                for c in ast.walk(head)
            ):
                return True
            if (
                used
                and not isinstance(s, ast.For)
                and any(id(s) in self.inside[id(lp)] and lp.lineno > st.lineno and ok(lp.iter) for lp in self.loops)
            ):
                return True
            made_here = (
                {t.id for t in ast.walk(s.target) if isinstance(t, ast.Name)}
                if isinstance(s, ast.For)
                else targets_of(s)
            )
            if used:
                tainted |= made_here
            elif isinstance(s, ast.Assign):
                tainted -= made_here  # rebound from other data
        return False


GROUP_KINDS = {
    "GroupKFold",
    "GroupShuffleSplit",
    "LeaveOneGroupOut",
    "LeavePGroupsOut",
    "StratifiedGroupKFold",
    "PredefinedSplit",
    "TimeSeriesSplit",
}


def _fits(ctx: Ctx, name: str, line: int) -> list[ast.Call]:
    """Fit calls of `name` up to `line`: `name.fit(A, B)` or `name = Cls(...).fit(A, B)`."""
    binds = {
        id(n.value)
        for n in ast.walk(ctx.tree)
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)
    }
    return [
        c
        for c in ctx.calls
        if c.lineno <= line
        and isinstance(c.func, ast.Attribute)
        and c.func.attr in FITS
        and ((isinstance(c.func.value, ast.Name) and c.func.value.id == name) or id(c) in binds)
    ]


def _fitted_on_all(ctx: Ctx, name: str, line: int) -> bool:
    """`name` was fitted with labels on data that is not a train/test part."""
    return any(len(c.args) >= 2 and full(ctx, c.args) for c in _fits(ctx, name, line))


def _selects(ctx: Ctx, c: ast.Call, targets: set[str]) -> bool:
    f, name = c.func, last(dotted(c.func, ctx.aliases))
    if isinstance(f, ast.Attribute) and f.attr in FITS:
        kind = ctx.kind_of(f.value, c.lineno)
        return kind in SELECTORS and full(ctx, c.args) and (kind != "VarianceThreshold" or len(c.args) >= 2)
    if name in SCORE_FUNCS:
        return len(c.args) >= 2 and full(ctx, c.args)
    if (isinstance(f, ast.Attribute) and f.attr in STAT_TESTS) or name in STAT_TESTS:
        data = _data(c) or [f]
        return full(ctx, data) and any(is_target(a, targets) for a in [*data, f])
    return False


def _selection(flow: Flow) -> Iterator[Event]:
    ctx, targets = flow.ctx, target_names(flow.ctx)
    for c in (c for c in ctx.calls if _selects(ctx, c, targets)):
        st = flow.stmt_of(c)
        yield "R2.select_before_split", c, st, targets_of(st)
    for st in (s for s in flow.stmts if isinstance(s, ast.Assign)):
        for a in (n for n in ast.walk(st.value) if isinstance(n, ast.Attribute) and n.attr in COEF_ATTRS):
            if (
                isinstance(a.value, ast.Name)
                and ctx.kind_of(a.value, st.lineno) not in SELECTORS
                and _fitted_on_all(ctx, a.value.id, st.lineno)
            ):
                yield "R2.select_before_split", a, st, targets_of(st)
                break


def _scaling(flow: Flow) -> Iterator[Event]:
    """Scalers fitted on all labels; z-score / scale() functions over rows of all labels or all features."""
    ctx, targets = flow.ctx, target_names(flow.ctx)
    for c in (c for c in ctx.calls if c.args and full(ctx, c.args[:1])):
        f, origin = c.func, dotted(c.func, ctx.aliases) or ""
        st = flow.stmt_of(c)
        on_y = is_target(c.args[0], targets) or bool(targets_of(st) & targets)
        if isinstance(f, ast.Attribute) and f.attr in FITS and ctx.kind_of(f.value, c.lineno) in SCALERS:
            if on_y:
                yield "R2.target_before_split", c, st, targets_of(st)
        elif ZSCORE.match(last(origin)) or (last(origin) in SCALE_FUNCS and origin.startswith(("sklearn.", "scipy."))):
            axis = next((k.value for k in c.keywords if k.arg == "axis"), c.args[1] if len(c.args) > 1 else None)
            if leaky_axis(axis):
                yield "R2.target_before_split" if on_y else "R2.manual_stats_before_split", c, st, targets_of(st)


def confound_names(ctx: Ctx) -> set[str]:
    """Names computed from confound-like names or string keys (`covars = df[["age", "sex"]]`), followed 3 steps."""
    out: set[str] = set()
    pairs = assign_pairs(ctx.tree)
    for _ in range(3):
        out |= {n for made, value in pairs if _is_conf(value, out) for n in made}
    return out


def _is_conf(node: ast.AST, names: set[str]) -> bool:
    return any(
        (isinstance(n, ast.Name) and (n.id in names or CONFOUND.search(n.id)))
        or (isinstance(n, ast.Constant) and isinstance(n.value, str) and CONFOUND.search(n.value))
        for n in ast.walk(node)
    )


def _conf_fit(ctx: Ctx, c: ast.Call, conf: set[str]) -> bool:
    """A regression fitted with confounds as inputs (`.fit(C, X)`, `sm.OLS(X, C)`, `smf.ols("x ~ age", ...)`) on
    data that is not a train/test part."""
    data = [*c.args, *(k.value for k in c.keywords)]
    if isinstance(c.func, ast.Attribute) and c.func.attr == "fit" and len(c.args) >= 2:
        return full(ctx, data) and _is_conf(c.args[0], conf)
    if last(dotted(c.func, ctx.aliases)).lower() in {"ols", "wls", "glm", "gls"}:
        return full(ctx, data) and any(_is_conf(a, conf) for a in data)
    return False


def _residual_of(ctx: Ctx, st: ast.stmt, right: ast.expr, conf: set[str]) -> ast.expr | None:
    """In `X - <right>`: a `.predict` of a regression fitted on confounds, or `C @ beta` with confounds C."""
    for n in ast.walk(right):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "predict":
            base = n.func.value
            fits = (
                [base]
                if isinstance(base, ast.Call)
                else _fits(ctx, base.id, st.lineno)
                if isinstance(base, ast.Name)
                else []
            )
            if any(isinstance(f, ast.Call) and _conf_fit(ctx, f, conf) for f in fits):
                return n
        matmul = (isinstance(n, ast.BinOp) and isinstance(n.op, ast.MatMult)) or (
            isinstance(n, ast.Call) and last(dotted(n.func, ctx.aliases)) in {"dot", "matmul"}
        )
        if matmul and isinstance(n, ast.expr) and _is_conf(n, conf) and full(ctx, [right]):
            return n
    return None


def _resid_attr(ctx: Ctx, st: ast.stmt, conf: set[str]) -> ast.expr | None:
    """`.resid` of a statsmodels fit with confound inputs, inline or through a variable."""
    for a in (n for n in ast.walk(st) if isinstance(n, ast.Attribute) and n.attr in RESIDUALS):
        fitted = [n for n in ast.walk(a.value) if isinstance(n, ast.Call)]
        if isinstance(a.value, ast.Name):
            fitted += [
                n
                for b in ast.walk(ctx.tree)
                if isinstance(b, ast.Assign) and a.value.id in targets_of(b) and b.lineno <= st.lineno
                for n in ast.walk(b.value)
                if isinstance(n, ast.Call)
            ]
        if any(_conf_fit(ctx, f, conf) for f in fitted):
            return a
    return None


def _deconfounding(flow: Flow) -> Iterator[Event]:
    ctx, conf = flow.ctx, confound_names(flow.ctx)
    for st in (s for s in flow.stmts if not isinstance(s, (ast.Expr, ast.For))):
        rights = [n.right for n in ast.walk(st) if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Sub)]
        if isinstance(st, ast.AugAssign) and isinstance(st.op, ast.Sub):
            rights.append(st.value)
        hit = next((h for r in rights if (h := _residual_of(ctx, st, r, conf)) is not None), None)
        hit = hit or _resid_attr(ctx, st, conf)
        if hit is not None:
            yield "R2.confound_before_split", hit, st, targets_of(st)
    for c in ctx.calls:  # nilearn.signal.clean(X, confounds=C) on a subjects x features matrix, not per recording
        if (
            (dotted(c.func, ctx.aliases) or "").endswith("signal.clean")
            and any(k.arg == "confounds" for k in c.keywords)
            and full(ctx, c.args)
            and not flow.in_loop(c)
        ):
            holder = flow.stmt_of(c)
            yield "R2.confound_before_split", c, holder, targets_of(holder)


def _harmonising(flow: Flow) -> Iterator[Event]:
    """ComBat-type functions (`neuroCombat`, `pycombat`, `harmonizationLearn`, a script's own `combat`) or a
    `CombatModel().fit / fit_transform` on all rows. `harmonizationApply` / `.transform` only apply a learned model."""
    ctx = flow.ctx
    for c in ctx.calls:
        f, data = c.func, [*c.args, *(k.value for k in c.keywords if k.arg in ("dat", "data", "X"))]
        fitting = (
            isinstance(f, ast.Attribute) and f.attr in FITS and bool(HARMONISERS.search(ctx.kind_of(f.value, c.lineno)))
        )
        if (fitting or HARMONISERS.search(last(dotted(f, ctx.aliases)))) and full(ctx, data):
            st = flow.stmt_of(c)
            yield "R2.harmonise_before_split", c, st, targets_of(st)


def _reducing(flow: Flow) -> Iterator[Event]:
    """Imputers / reducers fitted on all rows; `df.fillna(df.mean())` with whole-data statistics."""
    ctx = flow.ctx
    for c in ctx.calls:
        if not isinstance(f := c.func, ast.Attribute):
            continue
        kind = ctx.kind_of(f.value, c.lineno)
        if f.attr in FITS and kind in REDUCERS | IMPUTERS and full(ctx, c.args[:1]):
            st = flow.stmt_of(c)
            yield "R2.impute_before_split" if kind in IMPUTERS else "R2.reduce_before_split", c, st, targets_of(st)
        elif f.attr == "fillna" and c.args and any(whole_stat(ctx, n, set()) for n in ast.walk(c.args[0])):
            st = flow.stmt_of(c)
            yield "R2.impute_before_split", c, st, targets_of(st)


def _augmenting(flow: Flow) -> Iterator[Event]:
    ctx = flow.ctx
    for c in ctx.calls:
        origin = dotted(c.func, ctx.aliases) or ""
        bound = ctx.origin_of(c.func, c.lineno) if isinstance(c.func, ast.Name) else ""
        named = AUGMENT.search(last(origin)) or f"{origin}.".startswith(AUG_MODULES) or bound.startswith(AUG_MODULES)
        data = [*c.args, *(k.value for k in c.keywords)]
        if named and full(ctx, data) and any(isinstance(n, ast.Name) for d in data for n in ast.walk(d)):
            st = flow.stmt_of(c)
            yield "R2.augment_before_split", c, st, targets_of(st)


DETECTORS: list[tuple[Callable[[Flow], Iterator[Event]], bool]] = [  # (detector, only a group-blind split counts)
    (_selection, False),
    (_scaling, False),
    (_deconfounding, False),
    (_harmonising, False),
    (_reducing, False),
    (_augmenting, False),
]


def fitted_on_all(ctx: Ctx) -> list[tuple[str, int]]:
    flow, out = Flow(ctx), []
    for detect, random_only in DETECTORS:
        for code, call, st, made in detect(flow):
            if flow.reaches_split(call, st, made, random_only):
                out.append((code, call.lineno))
    return out
