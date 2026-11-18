"""用在哪里 and 标黄 on the computer: the user's own notes, matched sentence by sentence to the AI's answers.

Similarity is the Dice coefficient of character pairs after dropping spaces and punctuation, so it works for Chinese
and English alike, needs no model and nothing leaves the computer. A pair at or above THRESHOLD counts; the threshold
was set on the team's hand-written pairs in tests/test_desktop_sync.py, not on real notes."""
from __future__ import annotations

import re
import sqlite3
from dataclasses import asdict, dataclass
from typing import Any

from ...kernel.db import rows, utcnow
from ...kernel.events import emit

THRESHOLD = 0.6
MIN_CHARS = 8  # shorter sentences ("见上。") match too easily to mean anything
DOC_KINDS = ("note", "manuscript", "report")
_SENTENCE_END = re.compile(r"(?<=[。！？!?；;])|(?<=\.)\s+|\n+")
_NOISE = re.compile(r"[\W_]+")


def _grams(s: str) -> frozenset[str]:
    t = _NOISE.sub("", s.lower())
    return frozenset(t[i:i + 2] for i in range(len(t) - 1))


def similarity(a: str, b: str) -> float:
    ga, gb = _grams(a), _grams(b)
    return 2 * len(ga & gb) / (len(ga) + len(gb)) if ga and gb else 0.0


def sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_END.split(text) if len(_NOISE.sub("", s)) >= MIN_CHARS]


def paragraphs(body: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n|\n", body) if p.strip()]


@dataclass(frozen=True)
class Use:
    doc_id: str
    project_id: str
    title: str
    paragraph: str      # the whole paragraph, so the page can show it with the matched sentence marked
    sentence: str       # the user's sentence inside it
    score: float


def _docs(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    marks = ",".join("?" * len(DOC_KINDS))
    return rows(conn.execute(f"SELECT id, project_id, title, body FROM docs WHERE kind IN ({marks}) "
                             "AND conflict_of IS NULL ORDER BY updated_at DESC", DOC_KINDS))


def _best(claims: list[frozenset[str]], sentence: str) -> float:
    g = _grams(sentence)
    return max((2 * len(c & g) / (len(c) + len(g)) for c in claims if c and g), default=0.0)


def affected(conn: sqlite3.Connection, claim: str, limit: int = 5) -> list[dict[str, Any]]:
    """标黄: the paragraphs of the user's notes that use the recalled sentence, best match first."""
    grams = [_grams(claim)]
    found = []
    for d in _docs(conn):
        for para in paragraphs(d["body"]):
            scored = [(_best(grams, s), s) for s in sentences(para)]
            score, s = max(scored, default=(0.0, ""))
            if score >= THRESHOLD:
                found.append(Use(d["id"], d["project_id"], d["title"], para, s, round(score, 3)))
    return [asdict(u) for u in sorted(found, key=lambda u: -u.score)[:limit]]


def link_doc(conn: sqlite3.Connection, user_id: str, actor: str, doc: dict[str, Any]) -> list[str]:
    """After a note is saved: the open debts whose AI answer the note now uses. Fills 用在哪里 with the note's title
    where the user has not written one, and records the match. Returns the debts newly linked to this note."""
    mine = [sentences(p) for p in paragraphs(doc["body"])]
    said = [s for ps in mine for s in ps]
    if not said:
        return []
    entries = rows(conn.execute(
        "SELECT id, answer, used_in FROM mind_entries WHERE user_id=? AND dropped_on IS NULL AND answer<>'' "
        "AND id NOT IN (SELECT entry_id FROM mind_uses WHERE doc_id=?)", (user_id, doc["id"])))
    linked = []
    for e in entries:
        claims = [_grams(c) for c in sentences(e["answer"])]
        score, s = max(((_best(claims, s), s) for s in said), default=(0.0, ""))
        if score < THRESHOLD:
            continue
        conn.execute("INSERT INTO mind_uses(entry_id, doc_id, sentence, score, found_at) VALUES (?,?,?,?,?)",
                     (e["id"], doc["id"], s, round(score, 3), utcnow()))
        if not e["used_in"]:
            conn.execute("UPDATE mind_entries SET used_in=? WHERE id=?", ((doc["title"] or s)[:200], e["id"]))
        emit(conn, "mindledger.used_found", actor=actor, entity_type="mind_entry", entity_id=e["id"],
             data={"doc_id": doc["id"], "score": round(score, 3)})
        linked.append(e["id"])
    return linked
