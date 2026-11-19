"use strict";
const form = document.getElementById("f");
const msg = document.getElementById("msg");

chrome.storage.local.get("server").then(({ server }) => { if (server) form.server.value = server; });

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const server = new URL(form.server.value).origin;
  // Ask for access to this one address only, at the moment the user pairs.
  if (!(await chrome.permissions.request({ origins: [`${server}/*`] }))) return void (msg.textContent = "没有授权访问这个地址");
  await chrome.storage.local.set({ server });
  const res = await chrome.runtime.sendMessage({ type: "pair", code: form.code.value.replace(/[\s-]/g, "").toUpperCase() });
  msg.textContent = res.ok ? "配对成功，可以在 DeepSeek 或豆包网页上点「记一笔」了" : res.error;
});
