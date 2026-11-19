// node --test apps/extension/test  (jsdom is resolved from apps/web/node_modules)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = createRequire(new URL("../../web/package.json", import.meta.url))("jsdom");
const { describe } = require("../src/explain.js");

const open = { round: 1, done: false, ask: "原因链上还缺一环。", asking: 1,
  points: [{ type: "cause", state: "ok" }, { type: "cause", state: "more" }, { type: "cause", state: "review" }] };
const done = { round: 2, done: true, result: "followed", weight: "medium", first_rating: 2,
  points: [{ type: "cause", state: "ok", text: "甲" }, { type: "cause", state: "ok", text: "乙" }] };

test("an open round shows progress, three states and the follow-up, never the points' text", () => {
  const v = describe(open, "light");
  assert.equal(v.progress, "第 1 轮 · 讲到 1/3 个要点");
  assert.deepEqual(v.points.map((p) => p.state), ["通过", "需补充", "待复核"]);
  assert.equal(v.ask, "原因链上还缺一环。");
  assert.ok(v.points.every((p) => p.text === "") && !v.done);
});

test("the end says what happens next and when hints made the debt heavier", () => {
  const v = describe(done, "light");
  assert.ok(v.done && v.verdict.startsWith("补充后讲清楚了") && v.verdict.includes("记成「中」"));
  assert.equal(describe(done, "medium").verdict.includes("记成"), false);
  assert.deepEqual(v.points.map((p) => p.text), ["甲", "乙"]);
});

test("the panel books, explains twice and shows the end (content script in jsdom, server stubbed)", async () => {
  const html = readFileSync(new URL("fixtures/deepseek.html", import.meta.url), "utf8");
  const { window } = new JSDOM(html, { url: "https://chat.deepseek.com/a/chat", runScripts: "outside-only" });
  const sent = [];
  const replies = { record: { ok: true, id: "mind_1", weight: "light", due: "2026-12-04" },
    explain: [{ ok: true, reply: open }, { ok: true, reply: done }], hint: { ok: true, hint: { text: "还差一个讲原因或条件的要点。" } } };
  window.chrome = { runtime: { sendMessage: async (m) => {
    sent.push({ ...m }); // a plain copy: the page's objects come from another realm
    return m.type === "explain" ? replies.explain.shift() : replies[m.type];
  } } };
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function () { return attach.call(this, { mode: "open" }); };
  window.crypto.randomUUID ??= () => "uuid";
  for (const f of ["capture", "explain", "content"]) window.eval(readFileSync(new URL(`../src/${f}.js`, import.meta.url), "utf8"));
  const root = window.document.documentElement.lastElementChild.shadowRoot;
  const $ = (s) => root.querySelector(s);
  const tick = () => new Promise((r) => setTimeout(r, 0));

  assert.equal($(".fab").textContent, "记一笔");
  $(".fab").click();
  assert.equal($(".book").elements.question.value, "什么是导数？");
  $(".book").requestSubmit();
  await tick();
  assert.equal(sent[0].type, "record");
  assert.equal($(".talk").hidden, false);

  root.querySelector("[data-act=hint]").click();
  await tick();
  assert.equal($(".hint").textContent, "还差一个讲原因或条件的要点。");

  $(".talk").elements.text.value = "导数是变化率";
  $(".talk").requestSubmit();
  await tick();
  assert.deepEqual(sent.at(-1), { type: "explain", id: "mind_1", text: "导数是变化率" });
  assert.equal($(".ask").textContent, "原因链上还缺一环。");

  $(".talk").elements.text.value = "几何上是切线斜率";
  $(".talk").requestSubmit();
  await tick();
  assert.ok($(".ask").textContent.startsWith("补充后讲清楚了"));
  assert.equal($(".talk").elements.text.hidden, true);
  assert.equal($("ol").children.length, 2);
});
