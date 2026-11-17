"""Relay wiring (docs/OPS.md#model-relay): settings-driven, key from env only, vendor identity
kept for routing, relay prices separate. All calls are mocks or a patched httpx.post: zero network, zero spend."""

from __future__ import annotations

import json
import os
import sqlite3
from typing import Any

import httpx
import pytest

from researchos.contracts.gateway import ChatRequest, Message, TaskType
from researchos.kernel.config import Settings, load_settings
from researchos.services.gateway import catalog
from researchos.services.gateway.gateway import AINotConfigured
from researchos.services.gateway.keystore import SecretStore
from researchos.services.gateway.providers.http import RelayProvider, default_providers
from researchos.services.gateway.providers.mock import MockProvider
from researchos.services.wiring import build_services

from .m1_helpers import configure_models, mock_providers
from .test_m1_gateway import call

KEY = "sk-relay-SYNTHETIC-0000000000"


def test_relay_settings_from_env_and_key_captured(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    monkeypatch.setenv("RESEARCHOS_RELAY_BASE_URL", "https://relay.example.org/v1")
    monkeypatch.setenv("RESEARCHOS_RELAY_FOR", "anthropic, openai")
    monkeypatch.setenv("RESEARCHOS_RELAY_API_KEY", KEY)
    s = load_settings(tmp_path)
    assert s.relay_base_url == "https://relay.example.org/v1" and s.relay_for == ["anthropic", "openai"]
    ks = SecretStore(tmp_path / "config")
    ks.capture_env()
    assert "RESEARCHOS_RELAY_API_KEY" not in os.environ  # experiment/parse children can never inherit it
    assert ks.get("relay") == KEY and ks.status()["relay"] == {"configured": True, "source": "env"}
    assert "relay" in default_providers(s.relay_base_url) and "relay" not in default_providers("")


def test_relay_adapter_request_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    def fake_post(url: str, headers: dict[str, str], json: dict[str, Any], timeout: float) -> httpx.Response:
        seen.update(url=url, headers=headers, body=json)
        return httpx.Response(
            200,
            json={
                "id": "r1",
                "model": json["model"],
                "usage": {"prompt_tokens": 9, "completion_tokens": 3},
                "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    with pytest.raises(ValueError):
        RelayProvider("http://insecure.example.org/v1")
    r = RelayProvider("https://relay.example.org/v1/").complete(
        ChatRequest("gpt-6.1-sol", (Message("user", "hi"),), max_output_tokens=4), KEY
    )
    assert seen["url"] == "https://relay.example.org/v1/chat/completions"
    assert seen["headers"] == {"Authorization": f"Bearer {KEY}"}
    assert seen["body"]["model"] == "gpt-6.1-sol" and seen["body"]["max_tokens"] == 16  # relay refuses < 16
    assert r.text == "ok" and r.input_tokens == 9 and r.response_id == "r1"


@pytest.fixture
def relay_svc(settings: Settings) -> Any:
    settings.relay_base_url = "https://relay.example.org/v1"
    settings.relay_for = ["anthropic"]
    provs: dict[str, Any] = dict(mock_providers())
    provs["relay"] = MockProvider("relay", lambda req: json.dumps({"ok": True, "conf": 0.95}))
    return build_services(settings, load_plugins=False, providers=provs)


def test_vendor_routed_through_relay_needs_relay_price(relay_svc: Any, conn: sqlite3.Connection) -> None:
    svc = relay_svc
    configure_models(conn, svc)  # verified prices + keys for the direct vendors only
    with pytest.raises(AINotConfigured) as e:  # anthropic aliases now go via relay: no relay key/price yet
        call(svc, conn, task_type=TaskType.PREMIUM_AGENT)
    assert "relay" in e.value.message
    svc.keystore.set("relay", KEY)
    with pytest.raises(AINotConfigured) as e:
        call(svc, conn, task_type=TaskType.PREMIUM_AGENT)
    assert "price" in e.value.message  # direct anthropic price does not apply to the relay
    catalog.upsert_price(
        conn,
        {
            "provider": "relay",
            "model_id": "claude-opus-5-5",
            "currency": "CNY",
            "input_per_mtok": 1.0,
            "output_per_mtok": 2.0,
            "official_input_per_mtok": 1.0,
            "official_output_per_mtok": 2.0,
            "effective_date": "2026-10-12",
            "source": "test fixture",
            "verified": 1,
        },
    )
    res = call(svc, conn, task_type=TaskType.PREMIUM_AGENT)
    assert res.provider == "anthropic" and res.model_id == "claude-opus-5-5"  # vendor identity kept
    assert len(svc.gateway.providers["relay"].calls) == 1 and not svc.gateway.providers["anthropic"].calls
    row = conn.execute("SELECT provider, transport FROM model_calls ORDER BY created_at DESC LIMIT 1").fetchone()
    assert tuple(row) == ("anthropic", "relay")
    # unaffected vendors keep their direct adapter
    assert svc.gateway.transport_for("deepseek") == "deepseek" and svc.gateway.transport_for("anthropic") == "relay"


def _capture(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    seen: dict[str, Any] = {}

    def fake_post(url: str, headers: dict[str, str], json: dict[str, Any], timeout: float) -> httpx.Response:
        seen.update(url=url, body=json)
        return httpx.Response(
            200,
            json={"id": "r", "model": json["model"], "usage": {}, "choices": [{"message": {"content": "ok"}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    return seen


def test_openrouter_renames_models_and_refuses_data_collection(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture(monkeypatch)
    relay = RelayProvider("https://openrouter.ai/api/v1", {"deepseek-v4": "deepseek/deepseek-v4"})
    relay.complete(ChatRequest("deepseek-v4", (Message("user", "hi"),), max_output_tokens=64), KEY)
    assert seen["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert seen["body"]["model"] == "deepseek/deepseek-v4"
    assert seen["body"]["provider"] == {"data_collection": "deny"}
    relay.complete(ChatRequest("glm-5.3-flash", (Message("user", "hi"),), max_output_tokens=64), KEY)
    assert seen["body"]["model"] == "glm-5.3-flash"  # unlisted ids go unchanged


def test_other_relays_get_no_openrouter_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture(monkeypatch)
    RelayProvider("https://relay.example.org/v1").complete(
        ChatRequest("gpt-6.1-sol", (Message("user", "hi"),), max_output_tokens=64), KEY
    )
    assert "provider" not in seen["body"]


def test_relay_models_from_toml_and_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "researchos.toml").write_text('[relay_models]\n"deepseek-v4" = "deepseek/deepseek-v4"\n')
    assert load_settings(tmp_path).relay_models == {"deepseek-v4": "deepseek/deepseek-v4"}
    monkeypatch.setenv("RESEARCHOS_RELAY_MODELS", "a=x/a, b = y/b")
    assert load_settings(tmp_path).relay_models == {"a": "x/a", "b": "y/b"}
