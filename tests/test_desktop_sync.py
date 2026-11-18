"""Phone and computer together (ADR-275..277): pairing that keeps the phone signed in, 用在哪里 found in the user's
notes, the 标黄 paragraphs of a 召回单, and pushes to the owner's other devices. Everything runs on one test server;
the "phone" is a second client on a LAN address that pairs the way the app does (want_token, bearer header)."""
from __future__ import annotations

import sqlite3

import pytest
from fastapi import FastAPI

from researchos.app.factory import create_app
from researchos.kernel.config import Settings
from researchos.services.mindledger import uses
from researchos.services.wiring import build_services

from .conftest import Client
from .m1_helpers import mock_providers

API = "/api/v1"
NAP = "午睡二十分钟可以提高下午的记忆表现。夜里熬夜会让第二天的注意力变差。"

# Hand-written by the team: an AI sentence and the same point as a student copies it into notes (small edits), and
# pairs on the same subject that say something else. They set THRESHOLD; they are not real notes.
COPIED = [
    ("午睡二十分钟可以提高下午的记忆表现。", "午睡二十分钟能提高下午的记忆表现"),
    ("导数是函数在某点的瞬时变化率。", "导数就是函数在某一点的瞬时变化率。"),
    ("交叉验证时同一受试者的数据不能同时出现在训练集和测试集。",
     "交叉验证时，同一个受试者的数据不能同时出现在训练集和测试集里。"),
    ("fNIRS 测的是血氧浓度的变化，时间分辨率比 EEG 低。", "fNIRS 测量血氧浓度变化，时间分辨率比 EEG 低"),
    ("Batch normalization reduces internal covariate shift during training.",
     "Batch normalization reduces the internal covariate shift during training."),
    ("p 值小于 0.05 只说明数据和零假设不太相容，不说明效应大。",
     "p值小于0.05只说明数据和零假设不太相容，并不说明效应大"),
    ("傅里叶变换把信号从时域转到频域。", "傅里叶变换可以把信号从时域转换到频域。"),
    ("样本量太小时置换检验的分布会很粗糙。", "样本量太小的时候，置换检验的分布会很粗糙。"),
]
OTHER = [
    ("午睡二十分钟可以提高下午的记忆表现。", "晚上熬夜会降低第二天的注意力。"),
    ("导数是函数在某点的瞬时变化率。", "积分是求曲线下面积的方法。"),
    ("交叉验证时同一受试者的数据不能同时出现在训练集和测试集。", "训练集越大，模型的方差一般越小。"),
    ("fNIRS 测的是血氧浓度的变化，时间分辨率比 EEG 低。", "EEG 的空间分辨率比 fMRI 低很多。"),
    ("Batch normalization reduces internal covariate shift during training.",
     "Dropout randomly zeroes activations to reduce overfitting."),
    ("p 值小于 0.05 只说明数据和零假设不太相容，不说明效应大。", "效应量要用 Cohen's d 这类指标单独报告。"),
    ("傅里叶变换把信号从时域转到频域。", "小波变换在时间和频率上都有局部性。"),
    ("样本量太小时置换检验的分布会很粗糙。", "我们这次实验一共招了二十名被试。"),
]


@pytest.mark.parametrize(("ai", "note"), COPIED)
def test_a_copied_sentence_counts(ai: str, note: str) -> None:
    assert uses.similarity(ai, note) >= uses.THRESHOLD


@pytest.mark.parametrize(("ai", "note"), OTHER)
def test_another_point_on_the_same_subject_does_not(ai: str, note: str) -> None:
    assert uses.similarity(ai, note) < uses.THRESHOLD


def test_known_limit_own_words_are_missed() -> None:
    """Rewritten in the student's own words, the point is not found: this finds copying, not understanding."""
    assert uses.similarity("午睡二十分钟可以提高下午的记忆表现。", "下午小睡一会儿，东西记得更牢。") < uses.THRESHOLD


def test_sentences_skip_fragments() -> None:
    assert uses.sentences("见上。导数是函数在某点的瞬时变化率。\nOK") == ["导数是函数在某点的瞬时变化率。"]


# ---- the phone, paired the way the app pairs -----------------------------------------------------------------------

def _pair(desk: Client, app: FastAPI, name: str = "Android", ip: str = "192.168.1.40") -> tuple[Client, str, str]:
    code = desk.post(f"{API}/auth/pairing-codes", json={"device_name": name}).json()["code"]
    phone = Client(app, client=(ip, 5000))
    r = phone.post(f"{API}/auth/pair", json={"code": code, "device_name": name, "want_token": True})
    assert r.status_code == 200, r.text
    assert "ros_session" not in r.cookies  # the token is the session; no cookie for the native layer to lose
    token = r.json()["token"]
    phone.headers["authorization"] = f"Bearer {token}"
    return phone, token, r.json()["device_id"]


def test_pairing_keeps_the_phone_signed_in_across_a_restart(client: Client, app: FastAPI, settings: Settings) -> None:
    phone, token, dev = _pair(client, app)
    assert phone.get(f"{API}/auth/state").json()["authenticated"] is True
    restarted = create_app(settings, build_services(settings, load_plugins=False, providers=dict(mock_providers())))
    again = Client(restarted, client=("192.168.1.40", 5001))  # a new connection, nothing kept but the token
    again.headers["authorization"] = f"Bearer {token}"
    assert again.get(f"{API}/mind-ledger/due").status_code == 200
    assert client.post(f"{API}/devices/{dev}/revoke").status_code == 200
    assert again.get(f"{API}/mind-ledger/due").status_code == 401  # revoked on the computer: the phone must re-pair


def test_browsers_still_get_the_cookie_and_no_token(client: Client, app: FastAPI) -> None:
    code = client.post(f"{API}/auth/pairing-codes", json={"device_name": "iPad"}).json()["code"]
    ipad = Client(app, client=("192.168.1.30", 4000))
    r = ipad.post(f"{API}/auth/pair", json={"code": code, "device_name": "iPad"})
    assert r.status_code == 200 and r.json()["token"] is None and "ros_session" in r.cookies


# ---- 用在哪里 and 标黄 --------------------------------------------------------------------------------

def _entry(c: Client, cid: str, answer: str = NAP, **kw: object) -> str:
    body = {"client_id": cid, "question": "午睡和记忆", "help_level": "answer", "answer": answer, "board": "科研", **kw}
    r = c.post(f"{API}/mind-ledger/entries", json=body)
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def _note(c: Client, title: str, body: str) -> dict[str, object]:
    pid = c.post(f"{API}/projects", json={"title": "组会"}).json()["id"]
    r = c.post(f"{API}/projects/{pid}/notes", json={"title": title, "body": body})
    assert r.status_code == 201, r.text
    return dict(r.json())


def _used_in(conn: sqlite3.Connection) -> dict[str, str]:
    return {r[0]: r[1] for r in conn.execute("SELECT id, used_in FROM mind_entries")}


def test_a_note_that_uses_the_answer_fills_used_in(client: Client, conn: sqlite3.Connection) -> None:
    eid = _entry(client, "u-1")
    kept = _entry(client, "u-2", used_in="开题报告")
    other = _entry(client, "u-3", answer="傅里叶变换把信号从时域转到频域。")
    note = _note(client, "组会幻灯片草稿", "背景\n\n文献里说，午睡二十分钟能提高下午的记忆表现，所以我们……")
    due = _used_in(conn)
    assert due[eid] == "组会幻灯片草稿"
    assert due[kept] == "开题报告"  # what the user wrote is never replaced
    assert due[other] == ""
    upd = client.put(f"{API}/notes/{note['id']}", json={"title": "组会幻灯片", "body": str(note["body"]) + "\n补一句。",
                                                        "base_version": note["version"]})
    assert upd.status_code == 200
    assert _used_in(conn)[eid] == "组会幻灯片草稿"  # found once; renaming the note does not rewrite it


def test_recall_lists_the_paragraphs_it_touches(client: Client) -> None:
    eid = _entry(client, "r-1")
    _note(client, "第三章", "第一段与此无关，讲的是实验设备。\n\n已有研究表明午睡二十分钟可以提高下午的记忆表现。")
    rc = client.post(f"{API}/mind-ledger/entries/{eid}/recalls",
                     json={"claim": "午睡二十分钟可以提高下午的记忆表现。", "paper": "论文乙", "page": 4,
                           "quote": "午睡二十分钟不能提高下午的记忆表现。"})
    assert rc.status_code == 201
    [r] = client.get(f"{API}/mind-ledger/recalls").json()
    [hit] = r["affected"]
    assert hit["title"] == "第三章" and hit["paragraph"].startswith("已有研究表明")
    assert hit["sentence"] in hit["paragraph"] and hit["score"] >= uses.THRESHOLD


# ---- pushes ------------------------------------------------------------------------------------------------------

def test_a_recall_from_the_phone_reaches_the_computer_and_back(client: Client, app: FastAPI) -> None:
    phone, _, _ = _pair(client, app)
    eid = _entry(phone, "p-1")
    body = {"claim": "午睡二十分钟可以提高下午的记忆表现。", "paper": "论文乙", "page": 4,
            "quote": "午睡不能提高记忆。"}
    rid = phone.post(f"{API}/mind-ledger/entries/{eid}/recalls", json=body).json()["id"]
    phone.post(f"{API}/mind-ledger/entries/{eid}/recalls", json=body)  # a replay after a dropped connection
    [push] = client.get(f"{API}/pushes").json()
    assert (push["kind"], push["entity_id"], push["text"]) == ("recall", rid, body["claim"])
    assert phone.get(f"{API}/pushes").json() == []  # never to the device it came from
    assert phone.post(f"{API}/pushes/seen", json={"ids": [push["id"]]}).json()["seen"] == 0  # not the phone's
    assert client.post(f"{API}/pushes/seen", json={"ids": [push["id"]]}).json()["seen"] == 1
    assert client.get(f"{API}/pushes").json() == []
    client.post(f"{API}/mind-ledger/recalls/{rid}", json={"state": "accepted"})
    assert [(p["kind"], p["entity_id"]) for p in phone.get(f"{API}/pushes").json()] == [("recall_settled", rid)]


def test_found_uses_reach_the_phone_and_never_a_revoked_device(client: Client, app: FastAPI,
                                                               conn: sqlite3.Connection) -> None:
    phone, _, _ = _pair(client, app)
    _, _, old_dev = _pair(client, app, "旧手机", "192.168.1.41")
    client.post(f"{API}/devices/{old_dev}/revoke")
    eid = _entry(client, "e-1", source="manual")
    _note(client, "读书笔记", "午睡二十分钟可以提高下午的记忆表现。")
    assert [(p["kind"], p["entity_id"]) for p in phone.get(f"{API}/pushes").json()] == [("used", eid)]
    assert conn.execute("SELECT COUNT(*) FROM device_pushes WHERE device_id=?", (old_dev,)).fetchone()[0] == 0
