"""CSV tables for the null-world exam: read without loss, rewrite one column, and guess which columns hold the
group (subject) and the label."""

from __future__ import annotations

import csv
import io
from collections import Counter
from dataclasses import dataclass, replace

BOM = "﻿"
GROUP_HINTS = ("subject", "patient", "participant", "person", "record", "sub", "pid", "id", "受试者", "患者")
LABEL_HINTS = ("label", "target", "class", "diagnosis", "outcome", "y", "af", "标签", "诊断")
MAX_LABEL_CLASSES = 10


class TableError(ValueError):
    pass


@dataclass(frozen=True)
class Table:
    header: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]
    delimiter: str = ","
    newline: str = "\n"
    bom: bool = False

    @classmethod
    def parse(cls, raw: bytes) -> Table:
        text = raw.decode("utf-8-sig")
        try:
            delimiter = csv.Sniffer().sniff(text[:4096], delimiters=",;\t").delimiter
        except csv.Error:
            delimiter = ","
        records = [tuple(r) for r in csv.reader(io.StringIO(text), delimiter=delimiter) if r]
        if len(records) < 2:
            raise TableError("the table needs a header row and at least one data row")
        return cls(
            records[0], tuple(records[1:]), delimiter, "\r\n" if "\r\n" in text else "\n", raw.startswith(BOM.encode())
        )

    def column(self, name: str) -> list[str]:
        if name not in self.header:
            raise TableError(f"no column named {name!r}")
        i = self.header.index(name)
        return [r[i] for r in self.rows]

    def with_column(self, name: str, values: list[str]) -> Table:
        i = self.header.index(name)
        return replace(self, rows=tuple((*r[:i], v, *r[i + 1 :]) for r, v in zip(self.rows, values, strict=True)))

    def subset(self, rows: list[int]) -> Table:
        return replace(self, rows=tuple(self.rows[i] for i in rows))

    def to_bytes(self) -> bytes:
        out = io.StringIO()
        csv.writer(out, delimiter=self.delimiter, lineterminator=self.newline).writerows([self.header, *self.rows])
        return ((BOM if self.bom else "") + out.getvalue()).encode()


def numeric_features(table: Table, *exclude: str) -> list[str]:
    """Decimal-valued columns (integers such as window indices are left out), minus `exclude`."""
    out = []
    for name in table.header:
        values = table.column(name)
        if name in exclude or not any("." in v or "e" in v.lower() for v in values):
            continue
        try:
            [float(v) for v in values]
        except ValueError:
            continue
        out.append(name)
    return out


@dataclass(frozen=True)
class Candidate:
    column: str
    score: float
    reason: str


@dataclass(frozen=True)
class Structure:
    groups: list[Candidate]
    labels: list[Candidate]


def _hinted(name: str, hints: tuple[str, ...]) -> bool:
    n = name.lower()
    return any(n == h or n.startswith(h + "_") or n.endswith("_" + h) or (len(h) > 3 and h in n) for h in hints)


def _group_candidate(name: str, values: list[str]) -> Candidate | None:
    counts = Counter(values)
    if not 2 <= len(counts) <= len(values) // 2 or "" in counts:
        return None
    hinted = _hinted(name, GROUP_HINTS)
    reason = f"{len(counts)} distinct values, about {len(values) // len(counts)} rows each"
    return Candidate(name, 1.0 + hinted, reason + ("; the name looks like an ID" if hinted else ""))


def _label_candidate(name: str, values: list[str]) -> Candidate | None:
    classes = len(set(values))
    if not 2 <= classes <= MAX_LABEL_CLASSES or classes * 5 > len(values):
        return None
    hinted = _hinted(name, LABEL_HINTS)
    return Candidate(name, 1.0 + hinted, f"{classes} classes" + ("; the name looks like a label" if hinted else ""))


def detect(table: Table) -> Structure:
    """Rank the columns that could be the group and the label. A guess for the person to confirm, never final."""
    cols = {h: table.column(h) for h in table.header}
    groups = [c for h, v in cols.items() if (c := _group_candidate(h, v))]
    labels = [c for h, v in cols.items() if (c := _label_candidate(h, v))]
    groups.sort(key=lambda c: -c.score)  # stable: ties keep column order
    top_group = groups[0].column if groups else None
    labels = sorted((c for c in labels if c.column != top_group), key=lambda c: -c.score)
    return Structure(groups, labels)
