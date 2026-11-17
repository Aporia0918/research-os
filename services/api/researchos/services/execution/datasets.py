"""Dataset registry (K1 Dataset) + split materialization (split contract).

A dataset directory holds manifest.json {name, version, source, license, group_key, overlapping_windows,
files:[{path, sha256}], table: "<file>.npz"} and an .npz with arrays X, y, sample_id, group. Datasets are
registered by reference (external path + manifest hash); files are re-hashed on registration.
Materialization writes inputs/<split>.npz for exactly the splits a stage may see; test is never written before
final_eval.
"""

from __future__ import annotations

import hashlib
import json
import random
import sqlite3
from pathlib import Path
from typing import Any

from ...contracts.datasources import EGRESS_POLICIES
from ...contracts.errors import ApiError, not_found
from ...kernel.db import Row, jdump, new_id, row, tx, utcnow
from ...kernel.events import emit
from ..gateway import egress_index
from ..nullworld.worlds import layout, null_labels


def _sha_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def governance(m: dict[str, Any]) -> dict[str, Any]:
    """Governance JSON: the manifest's egress policy (validated), else local_only - fail closed (ADR-159)."""
    raw = m.get("governance")
    gov: dict[str, Any] = dict(raw) if isinstance(raw, dict) else {"data_class": "public"}
    egress = m.get("egress", gov.get("egress"))
    if egress is not None and egress not in EGRESS_POLICIES:
        raise ApiError(422, "bad_egress", f"egress must be one of {list(EGRESS_POLICIES)}, got {egress!r}")
    return {**gov, "egress": egress or "local_only"}


def register(conn: sqlite3.Connection, directory: Path, actor: str) -> Row:
    mf = directory / "manifest.json"
    if not mf.is_file():
        raise ApiError(422, "no_manifest", f"{directory} has no manifest.json")
    m = json.loads(mf.read_text(encoding="utf-8"))
    gov = governance(m)
    for f in m.get("files", []):
        if _sha_file(directory / f["path"]) != f["sha256"]:
            raise ApiError(422, "dataset_hash_mismatch", f"file {f['path']} does not match its manifest hash")
    with tx(conn):
        existing = row(conn.execute("SELECT * FROM datasets WHERE name=? AND version=?", (m["name"], m["version"])))
        if existing:
            if existing["manifest_sha256"] != _sha_file(mf):
                raise ApiError(409, "dataset_changed", "same name+version with different content; bump the version")
            egress_index.index(conn, existing)  # re-registration repairs a missing index (review #50)
            return existing
        did = new_id("ds")
        conn.execute(
            "INSERT INTO datasets(id,name,version,source,license,manifest_sha256,storage,group_key,governance,"
            "created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                did,
                m["name"],
                m["version"],
                m["source"],
                m["license"],
                _sha_file(mf),
                jdump({"kind": "external", "path": str(directory.resolve())}),
                m.get("group_key"),
                jdump(gov),
                utcnow(),
            ),
        )
        egress_index.index(conn, get(conn, did))
        emit(
            conn,
            "dataset.registered",
            actor=actor,
            entity_type="dataset",
            entity_id=did,
            data={"name": m["name"], "version": m["version"]},
        )
        return dict(row(conn.execute("SELECT * FROM datasets WHERE id=?", (did,))) or {})


def load_manifest(ds: Row) -> tuple[Path, dict[str, Any]]:
    d = Path(json.loads(ds["storage"])["path"])
    return d, json.loads((d / "manifest.json").read_text(encoding="utf-8"))


def get(conn: sqlite3.Connection, dataset_id: str) -> Row:
    d = row(conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)))
    if d is None:
        raise not_found("dataset")
    return d


def assign_groups(groups: list[Any], split: dict[str, Any]) -> dict[str, set[str]]:
    """split = {"kind":"groups","assign":{"train":[...],...}} or
    {"kind":"group_counts","seed":1,"counts":{"train":13,"search_val":4,"confirm_val":4},"test":[...]} or
    {"kind":"random_rows", ...} (rows, not groups: only for demonstrating leakage; D03 flags it)."""
    kind = split.get("kind")
    if kind == "groups":
        return {k: {str(g) for g in v} for k, v in split["assign"].items()}
    if kind == "group_counts":
        test = {str(g) for g in split.get("test", [])}
        pool = sorted({str(g) for g in groups} - test)
        random.Random(int(split.get("seed", 0))).shuffle(pool)
        out, i = {"test": test}, 0
        for name, n in split["counts"].items():
            out[name] = set(pool[i : i + int(n)])
            i += int(n)
        return out
    raise ApiError(422, "bad_split", f"unsupported split kind {kind!r}")


def materialize(ds: Row, split: dict[str, Any], splits: tuple[str, ...], out_dir: Path,
                shuffle_train_seed: int | None = None) -> dict[str, Any]:
    """Write inputs/<split>.npz for the requested splits only. Returns split hash + per-split sample ids."""
    try:
        import numpy as np
    except ImportError as e:  # experiments extra not installed
        raise ApiError(
            503, "missing_dependency", "numpy is required for datasets (install the experiments extra)"
        ) from e
    d, m = load_manifest(ds)
    with np.load(d / m["table"], allow_pickle=False) as npz:  # closed promptly (Windows file locks)
        data = {k: npz[k] for k in npz.files}
    groups = [str(g) for g in data["group"]]
    out_dir.mkdir(parents=True, exist_ok=True)
    ids: dict[str, list[str]] = {}
    if split.get("kind") == "random_rows":
        rng = random.Random(int(split.get("seed", 0)))
        order = list(range(len(groups)))
        rng.shuffle(order)
        cut = int(len(order) * float(split.get("train_fraction", 0.8)))
        rows_for = {"train": sorted(order[:cut]), "search_val": sorted(order[cut:])}
    else:
        assign = assign_groups(groups, split)
        rows_for = {s: [i for i, g in enumerate(groups) if g in assign.get(s, set())] for s in splits}
    for s in splits:
        idx = np.array(rows_for.get(s, []), dtype=int)
        arrays = {k: v[idx] for k, v in data.items()}
        if s == "train" and shuffle_train_seed is not None:  # negative control: a null world, not a row shuffle
            y = arrays["y"]
            arrays["y"] = np.array(_null_world(y.tolist(), [groups[i] for i in idx], shuffle_train_seed), dtype=y.dtype)
        np.savez(out_dir / f"{s}.npz", **arrays)
        ids[s] = [str(x) for x in data["sample_id"][idx]]
    split_hash = hashlib.sha256(jdump({"split": split, "dataset": ds["manifest_sha256"]}).encode()).hexdigest()
    return {
        "split_hash": split_hash,
        "ids": ids,
        "overlapping_windows": bool(m.get("overlapping_windows")),
        "group_key": m.get("group_key"),
    }


def _null_world(y: list[Any], groups: list[str], seed: int) -> list[Any]:
    """Shuffle labels the way the null-world exam does: keep each subject's labels together, so memorising subjects
    cannot beat chance. A plain row shuffle would let subject leakage pass the control."""
    labels = [str(v) for v in y]
    back = dict(zip(labels, y, strict=True))
    return [back[v] for v in null_labels(labels, groups, layout(labels, groups).mode, random.Random(seed))]
