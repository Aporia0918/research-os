"""模型读题：截图或自由文字 → Spec。OpenAI 兼容接口（OpenRouter / 国内模型均可）。

需要环境变量 CFQ_API_KEY；可选 CFQ_BASE_URL、CFQ_MODEL、CFQ_PRICE_IN/CFQ_PRICE_OUT（美元/百万 token）。
费用累计到 Budget，超过上限（默认 50 元）就停，不再调用。
"""

from __future__ import annotations

import base64
import json
import os
import urllib.request
from dataclasses import dataclass

import sympy as sp

from .spec import Spec
from .text import _expr

PROMPT = """把这道高数极限题转成 JSON，只输出 JSON：
{"var":"x","point":"0","side":"+-","params":{"a":"2"},"expr":"sin(a*x)/x","answer":"题目或解析里给出的答案，没有就写空串"}
point 用 0、1/2、pi/2、oo、-oo 这类写法；side 为 "+-"（双侧）、"+"（右）、"-"（左）；
expr 用 Python/sympy 写法（** 表示乘方，exp、log、sqrt）。"""


class BudgetExceeded(RuntimeError):
    pass


@dataclass
class Budget:
    cap_rmb: float = 50.0
    fx: float = 7.2  # 美元→人民币，按 7.2 估
    spent_rmb: float = 0.0
    calls: int = 0

    def charge(self, tokens_in: int, tokens_out: int) -> None:
        pin, pout = float(os.environ.get("CFQ_PRICE_IN", "0.3")), float(os.environ.get("CFQ_PRICE_OUT", "1.2"))
        self.spent_rmb += (tokens_in * pin + tokens_out * pout) / 1e6 * self.fx
        self.calls += 1

    def check(self) -> None:
        if self.spent_rmb >= self.cap_rmb:
            raise BudgetExceeded(f"模型费已到 {self.spent_rmb:.2f} 元，停止")


class ModelReader:
    def __init__(self, budget: Budget | None = None):
        self.key = os.environ["CFQ_API_KEY"]
        self.url = os.environ.get("CFQ_BASE_URL", "https://openrouter.ai/api/v1") + "/chat/completions"
        if not self.url.startswith("https://"):
            raise ValueError("CFQ_BASE_URL 必须是 https 地址")
        self.model = os.environ.get("CFQ_MODEL", "deepseek/deepseek-chat")
        self.budget = budget or Budget()
        self.last_answer: str = ""

    def _ask(self, content: list[dict]) -> dict:
        self.budget.check()
        body = {"model": self.model, "messages": [{"role": "user", "content": content}], "temperature": 0}
        if "openrouter.ai" in self.url:
            body["provider"] = {"data_collection": "deny"}
        req = urllib.request.Request(  # noqa: S310 构造时已限定 https
            self.url,
            json.dumps(body).encode(),
            {"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
            out = json.load(r)
        u = out.get("usage", {})
        self.budget.charge(u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
        raw = out["choices"][0]["message"]["content"].strip().removeprefix("```json").strip("`\n ")
        return json.loads(raw)

    def __call__(self, text: str = "", image: bytes | None = None) -> Spec:
        content: list[dict] = [{"type": "text", "text": PROMPT + ("\n\n题目：" + text if text else "")}]
        if image:
            url = "data:image/png;base64," + base64.b64encode(image).decode()
            content.append({"type": "image_url", "image_url": {"url": url}})
        j = self._ask(content)
        self.last_answer = j.get("answer", "")
        params = tuple((sp.Symbol(k), sp.nsimplify(v)) for k, v in j.get("params", {}).items())
        local = {j.get("var", "x"): sp.Symbol("x"), **{str(k): k for k, _ in params}}
        return Spec(_expr(j["expr"], local), _expr(str(j["point"]), local), j.get("side", "+-"), params)
