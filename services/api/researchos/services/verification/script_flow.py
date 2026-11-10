"""Script-audit rules that follow data from a transform to a later split (ADR-276, ADR-278): R5 resampling
(SMOTE-type / imblearn / smote_variants / sklearn.utils.resample) and R2's hand-written standardisation with
whole-array statistics (`R2.target_before_split` when the scaled array is the label, ADR-281). Split out of
script_audit.py, which owns the shared context and the report."""

from __future__ import annotations

import ast
import re
from typing import TYPE_CHECKING

from .script_source import dotted, last, names_in

if TYPE_CHECKING:
    from .script_audit import _Ctx as Ctx

RESAMPLE_METHODS = {"fit_resample", "fit_sample"}  # imblearn (fit_sample: before 0.4); smote_variants: .sample(X, y)
RESAMPLER_MODULES = ("imblearn.", "smote_variants.")
RESAMPLER_NAME = re.compile(r"smote|adasyn|sampler|nearmiss|tomek|centroids|nearestneighbours", re.I)
TARGET = re.compile(
    r"^(y|labels?|targets?|outcomes?|responses?|diagnos[ie]s|dx|phenotypes?|class(es)?)(_\w*)?$"
    r"|_(y|labels?|targets?)$",
    re.I,
)
Y_AT = {
    "cross_val_score": 2,
    "cross_validate": 2,
    "cross_val_predict": 2,
    "permutation_test_score": 2,
    "learning_curve": 2,
    "validation_curve": 2,
    "train_test_split": 1,
    "fit": 1,
    "fit_transform": 1,
    "fit_resample": 1,
    "split": 1,
}  # position of the labels in the call
STATS = {
    "mean",
    "std",
    "var",
    "max",
    "min",
    "median",
    "ptp",
    "amax",
    "amin",
    "quantile",
    "percentile",
    "nanmean",
    "nanstd",
    "nanvar",
    "nanmax",
    "nanmin",
    "nanmedian",
    "nanpercentile",
    "nanquantile",
}


def _ids(node: ast.AST) -> set[str]:
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}


def assign_pairs(tree: ast.AST) -> list[tuple[set[str], ast.expr]]:
    """(assigned names, value) per assignment; tuple unpacking `a, b = f(x), g(z)` is paired element by element."""
    pairs: list[tuple[set[str], ast.expr]] = []
    for st in (n for n in ast.walk(tree) if isinstance(n, ast.Assign)):
        for t in st.targets:
            if isinstance(t, ast.Tuple) and isinstance(st.value, ast.Tuple) and len(t.elts) == len(st.value.elts):
                pairs += [(_ids(a), b) for a, b in zip(t.elts, st.value.elts, strict=True)]
            else:
                pairs.append((_ids(t), st.value))
    return pairs


def target_names(ctx: Ctx) -> set[str]:
    """Names passed in the label position (`fit(X, y)`, `split(X, y)`, `cross_val_score(m, X, y)`), plus the names
    they are computed from (`y_t = pt.transform(y)`: pt, y), minus names passed in the feature position."""
    ys: set[str] = set()
    xs: set[str] = set()
    for c in ctx.calls:
        pos = Y_AT.get(c.func.attr if isinstance(c.func, ast.Attribute) else last(dotted(c.func, ctx.aliases)))
        if pos is not None and len(c.args) > pos:
            ys |= _ids(c.args[pos])
            xs |= _ids(c.args[pos - 1])
    pairs = assign_pairs(ctx.tree)
    for _ in range(3):
        ys |= {n for made, value in pairs if made & ys for n in _ids(value) if n not in ctx.aliases}
    return ys - xs


def is_target(node: ast.AST, targets: set[str]) -> bool:
    """A label: a label-like name or string key (`y`, `df["label"]`), or a name in `targets` (target_names)."""
    return bool(_ids(node) & targets) or any(
        TARGET.search(n.id if isinstance(n, ast.Name) else str(n.value))
        for n in ast.walk(node)
        if isinstance(n, ast.Name) or (isinstance(n, ast.Constant) and isinstance(n.value, str))
    )


def leaky_axis(axis: ast.AST | None) -> bool:
    """Statistics over rows: no axis (whole array; pandas default 0), axis=None, 0 or a tuple holding 0. Per-row /
    per-window axes (1, -1, ...) and axes in variables are not judged."""
    if axis is None:
        return True
    if isinstance(axis, ast.Tuple):
        return any(isinstance(e, ast.Constant) and e.value == 0 for e in axis.elts)
    return isinstance(axis, ast.Constant) and (axis.value is None or axis.value == 0) and axis.value is not False


def whole_stat(ctx: Ctx, e: ast.AST, stat_names: set[str]) -> bool:
    """`X.mean(0)`, `np.std(X)`, `df.max()`, or a name bound to one, computed on data that is not a train/test part."""
    if isinstance(e, ast.Name):
        return e.id in stat_names
    if not (isinstance(e, ast.Call) and isinstance(e.func, ast.Attribute) and e.func.attr in STATS):
        return False
    kw = {k.arg: k.value for k in e.keywords}
    full = dotted(e.func, ctx.aliases) or ""
    if isinstance(e.func.value, ast.Name) and e.func.value.id in ctx.aliases:  # function form: np.mean(X, axis)
        if not full.startswith("numpy.") or not e.args:
            return False
        data, axis = e.args[0], kw.get("axis", e.args[1] if len(e.args) > 1 else None)
    else:
        data, axis = e.func.value, kw.get("axis", e.args[0] if e.args else None)
    return leaky_axis(axis) and not ctx.is_train(data) and not ctx.is_test(data)


def r2_manual(ctx: Ctx) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    stat_names: set[str] = set()
    labels = target_names(ctx)
    splits = [c for c in ctx.calls if ctx.is_split_like(c)]
    stmts = sorted(
        (n for n in ast.walk(ctx.tree) if isinstance(n, (ast.Assign, ast.AugAssign))), key=lambda n: n.lineno
    )
    for st in stmts:
        targets = st.targets if isinstance(st, ast.Assign) else [st.target]
        made = {n.id for t in targets for n in ast.walk(t) if isinstance(n, ast.Name)}
        parts = st.value.elts if isinstance(st.value, ast.Tuple) else [st.value]
        if isinstance(st, ast.Assign) and all(whole_stat(ctx, v, stat_names) for v in parts):
            stat_names |= made  # mu, sd = X.mean(0), X.std(0)
            continue
        ops = [(n.op, n.left, n.right) for n in ast.walk(st.value) if isinstance(n, ast.BinOp)]
        if isinstance(st, ast.AugAssign):
            ops.append((st.op, st.target, st.value))
        scaled = any(
            isinstance(op, (ast.Sub, ast.Div))
            and any(whole_stat(ctx, n, stat_names) for side in (a, b) for n in ast.walk(side))
            for op, a, b in ops
        )
        if scaled and any(s.lineno > st.lineno and made & set(names_in(s)) for s in splits):
            on_y = all(is_target(ast.Name(id=m), labels) for m in made)
            out.append(("R2.target_before_split" if on_y else "R2.manual_stats_before_split", st.lineno))
    return out


def _is_resample(ctx: Ctx, c: ast.Call) -> bool:
    f = c.func
    if isinstance(f, ast.Attribute) and f.attr in RESAMPLE_METHODS:
        return True
    if isinstance(f, ast.Attribute) and f.attr == "sample" and len(c.args) >= 2:  # smote_variants: sampler.sample(X, y)
        origin = ctx.origin_of(f.value, c.lineno)
        return origin.startswith(RESAMPLER_MODULES) or bool(RESAMPLER_NAME.search(last(origin)))
    return (dotted(f, ctx.aliases) or "") == "sklearn.utils.resample" and any(
        k.arg == "replace" and isinstance(k.value, ast.Constant) and k.value.value is True for k in c.keywords
    )


def r5(ctx: Ctx) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    parent = {id(ch): node for node in ast.walk(ctx.tree) for ch in ast.iter_child_nodes(node)}
    splits = [c for c in ctx.calls if ctx.is_split_like(c)]
    for c in (c for c in ctx.calls if _is_resample(ctx, c)):
        data = [*c.args[:2], *(k.value for k in c.keywords if k.arg in ("X", "y"))]
        if any(ctx.is_test(d) for d in data):
            out.append(("R5.on_test", c.lineno))
            continue
        if any(ctx.is_train(d) for d in data):
            continue
        node: ast.AST = c
        while id(node) in parent and not isinstance(node, ast.stmt):  # the statement holding the call
            node = parent[id(node)]
        made = {n.id for t in getattr(node, "targets", []) for n in ast.walk(t) if isinstance(n, ast.Name)}
        nested = any(s is not c and any(n is c for n in ast.walk(s)) for s in splits)
        later = any(s.lineno > c.lineno and made & set(names_in(s)) for s in splits)
        if nested or later:
            out.append(("R5.before_split", c.lineno))
    return out
