"""HTTP adapters for real providers (DeepSeek, Zhipu, Qwen, OpenAI = OpenAI-compatible chat API; Anthropic Messages).
Qwen uses DashScope's Beijing compatible-mode host; Alibaba's docs (2026-10) also offer per-workspace hosts, and keys
are region-bound, so a Singapore key needs the relay setting or a different URL.
Endpoints/headers are config-like constants; verify against provider docs before first paid use (NOT RUN: tests
make no paid calls). Keys are passed per call from the keystore and never logged."""
from __future__ import annotations

from typing import Any

import httpx

from ....contracts.gateway import ChatRequest, ChatResponse, ProviderError

OPENAI_COMPAT_URLS = {
    "deepseek": "https://api.deepseek.com/chat/completions",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    "openai": "https://api.openai.com/v1/chat/completions",
}
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def _raise_for(resp: httpx.Response) -> None:
    if resp.status_code < 400:
        return
    if resp.status_code == 429:
        ra = resp.headers.get("retry-after")
        wait = float(ra) if ra and ra.isdigit() else None
        raise ProviderError("rate_limited", "provider rate limit", retry_after_s=wait)
    if resp.status_code in (401, 403):
        raise ProviderError("auth", f"provider rejected credentials or region ({resp.status_code})")
    if resp.status_code >= 500:
        raise ProviderError("server", f"provider error {resp.status_code}", maybe_billed=False)
    raise ProviderError("bad_request", f"provider rejected request {resp.status_code}: {resp.text[:200]}")


def _post(url: str, headers: dict[str, str], body: dict[str, Any], timeout: float) -> dict[str, Any]:
    try:
        resp = httpx.post(url, headers=headers, json=body, timeout=timeout)
    except httpx.TimeoutException as e:
        raise ProviderError("timeout", "provider timed out; the call may have been billed", maybe_billed=True) from e
    except httpx.ConnectError as e:  # request never reached the provider: safe to retry
        raise ProviderError("network", f"could not connect: {type(e).__name__}") from e
    except httpx.TransportError as e:  # broke after sending: delivery uncertain, may be billed
        raise ProviderError("timeout", f"connection broke mid-call: {type(e).__name__}", maybe_billed=True) from e
    _raise_for(resp)
    data: dict[str, Any] = resp.json()
    return data


class OpenAICompatProvider:
    min_output_tokens = 1

    def __init__(self, name: str, url: str | None = None) -> None:
        self.name = name
        self.url = url or OPENAI_COMPAT_URLS[name]
        self.location = "cloud"  # a loopback URL may be a tunnel to a vendor; local needs owner trust (review #48)

    def complete(self, req: ChatRequest, api_key: str) -> ChatResponse:
        body: dict[str, Any] = {"model": req.model_id, "temperature": req.temperature,
                                "max_tokens": max(req.max_output_tokens, self.min_output_tokens),
                                "messages": [{"role": m.role, "content": m.content} for m in req.messages]}
        if req.json_mode:
            body["response_format"] = {"type": "json_object"}
        d = _post(self.url, {"Authorization": f"Bearer {api_key}"}, body, req.timeout_s)
        usage = d.get("usage") or {}
        choice = d["choices"][0]
        return ChatResponse(text=choice["message"]["content"] or "", input_tokens=int(usage.get("prompt_tokens", 0)),
                            output_tokens=int(usage.get("completion_tokens", 0)), response_id=d.get("id"),
                            model_id=d.get("model", req.model_id), raw_finish_reason=choice.get("finish_reason"))


class AnthropicProvider:
    name = "anthropic"
    location = "cloud"

    def complete(self, req: ChatRequest, api_key: str) -> ChatResponse:
        system = "\n\n".join(m.content for m in req.messages if m.role == "system")
        msgs = [{"role": m.role, "content": m.content} for m in req.messages if m.role in ("user", "assistant")]
        body: dict[str, Any] = {"model": req.model_id, "max_tokens": req.max_output_tokens,
                                "temperature": req.temperature, "messages": msgs}
        if system:
            body["system"] = system
        d = _post(ANTHROPIC_URL, {"x-api-key": api_key, "anthropic-version": "2023-06-01"}, body, req.timeout_s)
        text = "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")
        u = d.get("usage") or {}
        return ChatResponse(text=text, input_tokens=int(u.get("input_tokens", 0)),
                            output_tokens=int(u.get("output_tokens", 0)), response_id=d.get("id"),
                            model_id=d.get("model", req.model_id), raw_finish_reason=d.get("stop_reason"))


class RelayProvider(OpenAICompatProvider):
    """OpenAI-compatible relay serving several vendors' models under their own model ids (docs/OPS.md#model-relay).
    The relay sees all content sent to it. Some relays refuse very small max_tokens ("probe requests")."""

    min_output_tokens = 16

    def __init__(self, base_url: str) -> None:
        if not base_url.startswith("https://"):
            raise ValueError("relay_base_url must be an https URL")
        super().__init__("relay", base_url.rstrip("/") + "/chat/completions")


def default_providers(relay_base_url: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {**{n: OpenAICompatProvider(n) for n in OPENAI_COMPAT_URLS}, "anthropic": AnthropicProvider()}
    if relay_base_url:
        out["relay"] = RelayProvider(relay_base_url)
    return out
