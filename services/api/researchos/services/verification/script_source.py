"""Source side of the script leakage audit (ADR-271): turn a user's .py / .ipynb into parsed code without running it,
resolve import aliases, map line numbers back to notebook cells."""

from __future__ import annotations

import ast
import json
from dataclasses import dataclass, field
from pathlib import Path

MAX_BYTES = 2_000_000  # larger files are not training scripts; refusing keeps the parse cheap
MAX_SKIPPED = 5  # unparsable lines blanked before the audit gives up (ADR-279)


class SourceError(ValueError):
    def __init__(self, code: str, message: str, line: int | None = None) -> None:
        super().__init__(message)
        self.code, self.line = code, line


@dataclass
class Source:
    text: str
    filename: str
    cells: list[tuple[int, int]] = field(default_factory=list)  # per script line (1-based index - 1): (cell, line)
    skipped: list[tuple[int, str]] = field(default_factory=list)  # (line, Python's message), filled by parse()

    def where(self, line: int) -> dict[str, int | None]:
        if not self.cells or not 1 <= line <= len(self.cells):
            return {"cell": None, "cell_line": None}
        cell, cell_line = self.cells[line - 1]
        return {"cell": cell, "cell_line": cell_line}

    def snippet(self, line: int) -> str:
        lines = self.text.splitlines()
        return lines[line - 1].strip()[:160] if 1 <= line <= len(lines) else ""


def notebook_source(raw: str, filename: str = "notebook.ipynb") -> Source:
    """Code cells joined into one script. IPython magics / shell lines become comments so line numbers stay put;
    `cell` is the 1-based position among all cells (markdown included), as the notebook shows them."""
    try:
        nb = json.loads(raw)
        cells = nb["cells"]
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        raise SourceError("bad_notebook", "not a readable Jupyter notebook") from e
    out: list[str] = []
    where: list[tuple[int, int]] = []
    for ci, cell in enumerate(cells, start=1):
        if not isinstance(cell, dict) or cell.get("cell_type") != "code":
            continue
        src = cell.get("source", "")
        text = "".join(src) if isinstance(src, list) else str(src)
        for li, line in enumerate(text.splitlines(), start=1):
            out.append("# " + line if line.lstrip().startswith(("%", "!", "?")) else line)
            where.append((ci, li))
    return Source("\n".join(out) + "\n", filename, where)


def load_path(path: Path) -> Source:
    """Read-only: the file is read as bytes once; nothing is imported or executed."""
    if path.stat().st_size > MAX_BYTES:
        raise SourceError("too_large", f"file larger than {MAX_BYTES // 1_000_000} MB")
    text = path.read_bytes().decode("utf-8", errors="replace")
    if path.suffix.lower() == ".ipynb":
        return notebook_source(text, path.name)
    return Source(text, path.name)


def parse(src: Source) -> ast.Module:
    """Parse; a line Python rejects (stray prose, a merge marker) is replaced by `pass` at its indentation, or by
    nothing, and recorded in `src.skipped`, at most MAX_SKIPPED lines. Gives up (SourceError) beyond that, when the
    error has no usable line, or when nothing parsable is left."""
    if len(src.text.encode("utf-8")) > MAX_BYTES:
        raise SourceError("too_large", f"source larger than {MAX_BYTES // 1_000_000} MB")
    lines, first = src.text.splitlines(), None
    tries: dict[int, int] = {}  # line -> 1 (now `pass`) or 2 (now empty)
    src.skipped = []
    while True:
        try:
            tree = ast.parse("\n".join(lines) + "\n", filename=src.filename)
            break
        except SyntaxError as e:
            first = first or e
            n = e.lineno or 0
            if not 1 <= n <= len(lines) or tries.get(n) == 2 or (n not in tries and len(tries) == MAX_SKIPPED):
                raise SourceError(
                    "syntax_error", f"Python could not parse the file: {first.msg}", first.lineno
                ) from first
            if n not in tries:
                src.skipped.append((n, e.msg))
            text = lines[n - 1]
            tries[n] = tries.get(n, 0) + 1
            lines[n - 1] = text[: len(text) - len(text.lstrip())] + "pass" if tries[n] == 1 else ""
    if first and not any(isinstance(s, ast.stmt) and not isinstance(s, ast.Pass) for s in ast.walk(tree)):
        raise SourceError("syntax_error", f"Python could not parse the file: {first.msg}", first.lineno)
    return tree


def import_aliases(tree: ast.AST) -> dict[str, str]:
    """Local name -> dotted origin: `import numpy as np` -> np: numpy; `from x import y as z` -> z: x.y."""
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                out[a.asname or a.name.split(".")[0]] = a.name if a.asname else a.name.split(".")[0]
        elif isinstance(node, ast.ImportFrom) and node.module:
            for a in node.names:
                out[a.asname or a.name] = f"{node.module}.{a.name}"
    return out


def dotted(node: ast.AST, aliases: dict[str, str]) -> str | None:
    """`np.random.randn` -> numpy.random.randn; `StandardScaler().fit` -> sklearn....StandardScaler().fit."""
    if isinstance(node, ast.Name):
        return aliases.get(node.id, node.id)
    if isinstance(node, ast.Attribute):
        base = dotted(node.value, aliases)
        return f"{base}.{node.attr}" if base else None
    if isinstance(node, ast.Call):
        base = dotted(node.func, aliases)
        return f"{base}()" if base else None
    return None


def last(name: str | None) -> str:
    return (name or "").rstrip("()").rsplit(".", 1)[-1]


def names_in(node: ast.AST) -> list[str]:
    """Identifiers and string constants inside an expression (for train / test / subject heuristics)."""
    out: list[str] = []
    for n in ast.walk(node):
        if isinstance(n, ast.Name):
            out.append(n.id)
        elif isinstance(n, ast.Attribute):
            out.append(n.attr)
        elif isinstance(n, ast.Constant) and isinstance(n.value, str):
            out.append(n.value)
    return out
