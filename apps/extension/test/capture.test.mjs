// node --test apps/extension/test  (jsdom is resolved from apps/web/node_modules)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = createRequire(new URL("../../web/package.json", import.meta.url))("jsdom");
const { extractLastTurn, toEntry } = require("../src/capture.js");

const page = (name) => new JSDOM(readFileSync(new URL(`fixtures/${name}.html`, import.meta.url), "utf8")).window.document;
const shared = JSON.parse(readFileSync(new URL("fixtures/entry.json", import.meta.url), "utf8"));

test("DeepSeek-shaped page: the last answer and the question right before it", () => {
  const turn = extractLastTurn(page("deepseek"), "chat.deepseek.com");
  assert.equal(turn.question, "什么是导数？");
  assert.equal(turn.answer, "导数是函数在某点的瞬时变化率。\n几何上它是切线的斜率。");
});

test("Doubao-shaped page", () => {
  assert.deepEqual(extractLastTurn(page("doubao"), "www.doubao.com"),
    { question: "细胞膜的主要成分？", answer: "磷脂双分子层和蛋白质。" });
});

test("unrecognised page returns null, so the button asks the user to select text", () => {
  assert.equal(extractLastTurn(page("unknown"), "example.com"), null);
});

test("entry body matches the fixture the backend test posts", () => {
  const turn = extractLastTurn(page("deepseek"), "chat.deepseek.com");
  const entry = toEntry(turn, { help: "answer", ownIdea: "好像和斜率有关", topic: "高数" }, "ext-1");
  assert.deepEqual(entry, { client_id: "ext-1", ...shared });
});

test("an edited question wins; an empty one is refused", () => {
  assert.equal(toEntry({ question: "", answer: "x" }, { help: "hint", question: "自己写的题" }, "c").question, "自己写的题");
  assert.throws(() => toEntry({ question: "", answer: "x" }, { help: "hint" }, "c"), /question is empty/);
  assert.throws(() => toEntry({ question: "q", answer: "x" }, { help: "copy" }, "c"), /help must be/);
});
