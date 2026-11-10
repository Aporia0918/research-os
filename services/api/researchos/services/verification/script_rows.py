"""Script-audit rules on rows rather than fitted steps (ADR-285, ADR-286), on the data-flow engine of
script_fitall.py: rows copied or appended before a split that ignores groups (R5 family), and train / validation /
test parts joined and then split again (R1 family, yellow)."""

from __future__ import annotations

import ast
import re
from collections.abc import Iterator
from typing import TYPE_CHECKING

from .script_fitall import Event, Flow, full, targets_of
from .script_source import dotted, last

if TYPE_CHECKING:
    from .script_audit import _Ctx as Ctx

CONCAT = {"vstack", "concatenate", "row_stack", "concat", "append"}
JOIN = CONCAT | {"hstack", "union", "extend", "chain"}
OTHER_PART = re.compile(r"(^|_)(val|valid|validation|dev|test|holdout|eval)(_|$|\d)", re.I)
YELLOW = {"R1.resplit_joined_parts"}  # fine if the new split keeps subjects apart; the script alone may not show it
TEXT: dict[str, tuple[str, str]] = {
    "R1.resplit_joined_parts": (
        "the training part and a validation / test part are joined and then split again "
        "without groups, so the earlier separation is lost and rows of one subject (or the "
        "former test rows) can land on both sides",
        "Keep the original subject-wise parts, "
        "or split the joined data again by subject (GroupKFold / GroupShuffleSplit with "
        "groups=<subject column>).",
    ),
    "R5.duplicated_before_split": (
        "rows are copied or appended (copies of some rows, repeat / tile, sampling with "
        "replacement) before a split that ignores groups, so copies of the same row can "
        "land in both training and test data",
        "Copy or oversample rows only in the "
        "training part after the split, or split by an ID that every copy keeps "
        "(GroupKFold with groups=<original row or subject ID>).",
    ),
}


def _axis_rows(c: ast.Call) -> bool:
    """No axis, axis 0 or "index" (pandas)."""
    axis = next((k.value for k in c.keywords if k.arg == "axis"), None)
    return axis is None or (isinstance(axis, ast.Constant) and axis.value in (0, "index"))


def _bare(e: ast.expr) -> str | None:
    """`X`, `X.values`, `df.to_numpy()`, `df.copy()`: the whole of one variable."""
    if (
        isinstance(e, ast.Call)
        and isinstance(e.func, ast.Attribute)
        and e.func.attr in ("to_numpy", "copy")
        and not e.args
    ):
        e = e.func.value
    if isinstance(e, ast.Attribute) and e.attr == "values":
        e = e.value
    return e.id if isinstance(e, ast.Name) else None


def parts(c: ast.Call) -> list[ast.expr]:
    """Pieces joined by a concat-like call: the list / tuple argument, or the object and its argument for
    `df.append(other)` / `np.append(X, Z)`."""
    if c.args and isinstance(c.args[0], (ast.List, ast.Tuple)):
        return list(c.args[0].elts)
    f = c.func
    if isinstance(f, ast.Attribute) and f.attr == "append" and c.args:
        return (
            [f.value, c.args[0]]
            if not isinstance(f.value, ast.Name) or f.value.id not in ("np", "numpy")
            else list(c.args[:2])
        )
    return []


def _copies(ctx: Ctx, c: ast.Call) -> bool:
    f, name = c.func, last(dotted(c.func, ctx.aliases))
    if name in CONCAT and _axis_rows(c):
        pieces = parts(c)
        bare = {b for p in pieces if (b := _bare(p))}
        return any(
            _bare(p) != n and any(isinstance(m, ast.Name) and m.id == n for m in ast.walk(p))
            for n in bare
            for p in pieces
        )  # X with X[idx], df with df.sample(...), X with X + noise
    if name == "repeat":
        if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Attribute) and f.value.attr == "index":
            return True  # df.loc[df.index.repeat(w)]
        axis = next((k.value for k in c.keywords if k.arg == "axis"), c.args[2] if len(c.args) > 2 else None)
        return isinstance(axis, ast.Constant) and axis.value == 0
    if name == "tile" and len(c.args) >= 2:
        reps = c.args[1]
        return (
            isinstance(reps, ast.Tuple)
            and len(reps.elts) > 1
            and not (isinstance(reps.elts[0], ast.Constant) and reps.elts[0].value == 1)
        )
    return name == "sample" and any(
        k.arg == "replace" and isinstance(k.value, ast.Constant) and k.value.value is True for k in c.keywords
    )


def _duplicating(flow: Flow) -> Iterator[Event]:
    ctx = flow.ctx
    for c in ctx.calls:
        data = [*c.args, *([c.func.value] if isinstance(c.func, ast.Attribute) else [])]
        if _copies(ctx, c) and full(ctx, data):
            st = flow.stmt_of(c)
            yield "R5.duplicated_before_split", c, st, targets_of(st)


def _pieces(ctx: Ctx, node: ast.AST) -> list[ast.expr]:
    """Operands of `a + b + c` / `a | b`, pieces of a concat-like call, or object and argument of `a.extend(b)`."""
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.BitOr)):
        return [*_pieces(ctx, node.left), *_pieces(ctx, node.right)]
    if isinstance(node, ast.Call) and last(dotted(node.func, ctx.aliases)) in JOIN:
        f = node.func
        if isinstance(f, ast.Attribute) and f.attr in ("extend", "union") and node.args:
            return [f.value, *node.args]
        return parts(node) or list(node.args)
    return [node] if isinstance(node, ast.expr) else []


def _rejoining(flow: Flow) -> Iterator[Event]:
    ctx = flow.ctx
    for st in flow.stmts:
        value = st.value if isinstance(st, (ast.Assign, ast.Expr)) else None
        if value is None or not isinstance(value, (ast.BinOp, ast.Call)):
            continue
        pieces = _pieces(ctx, value)
        names = [[n.id for n in ast.walk(p) if isinstance(n, ast.Name)] for p in pieces]
        if (
            len(pieces) >= 2
            and any(ctx.is_train(p) for p in pieces)
            and any(
                not ctx.is_train(p) and any(OTHER_PART.search(n) for n in ns)
                for p, ns in zip(pieces, names, strict=True)
            )
        ):
            yield "R1.resplit_joined_parts", value, st, targets_of(st)


def copied_rows(ctx: Ctx) -> list[tuple[str, int]]:
    flow = Flow(ctx)
    return [
        (code, node.lineno)
        for detect in (_duplicating, _rejoining)
        for code, node, st, made in detect(flow)
        if flow.reaches_split(node, st, made, random_only=True)
    ]
