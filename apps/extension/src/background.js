// Sends a captured entry to the user's own ResearchOS server. The server address and the paired session live
// only in this browser; nothing goes anywhere else.
"use strict";

const HEADERS = { "content-type": "application/json", "x-researchos-client": "mind-ledger-extension" };

async function server() {
  const { server: url } = await chrome.storage.local.get("server");
  if (!url) throw new Error("先在插件设置里填电脑上的地址并配对");
  return url.replace(/\/+$/, "");
}

async function post(path, body, key) {
  const res = await fetch(`${await server()}${path}`, {
    method: "POST", credentials: "include", body: JSON.stringify(body),
    headers: { ...HEADERS, "idempotency-key": key },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 401 ? "配对已过期，请重新配对" : data.message || `出错了 (${res.status})`);
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const run = msg.type === "record"
    ? post("/api/v1/mind-ledger/entries", msg.entry, msg.entry.client_id).then((e) => ({ ok: true, due: e.due_on }))
    : msg.type === "pair"
      ? post("/api/v1/auth/pair", { code: msg.code, device_name: "浏览器插件" }, crypto.randomUUID()).then(() => ({ ok: true }))
      : Promise.resolve({ ok: false, error: "unknown message" });
  run.catch((e) => ({ ok: false, error: e.message })).then(reply);
  return true; // async reply
});
