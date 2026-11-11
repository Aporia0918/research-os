// 思维账本 capture: find the last question/answer pair on a web AI chat page, or use the selected text.
// Pure DOM reading, no network. Runs as a content script (window.MindCapture) and under node tests (module.exports).
// The site selectors are a best guess at each site's structure and break when a site changes its markup;
// selecting text and pressing the button always works as the fallback.
(function (root) {
  "use strict";

  const MAX_TEXT = 8000;
  const HELP = { hint: "提示", approach: "思路", answer: "完整答案" };

  /** host -> where the user's messages and the AI's answers live. GENERIC covers sites with no adapter. */
  const SITES = {
    "chat.deepseek.com": { user: "[class*='user-message'], [data-role='user']", ai: ".ds-markdown, [data-role='assistant']" },
    "www.doubao.com": { user: "[data-testid='send_message']", ai: "[data-testid='receive_message']" },
  };
  const GENERIC = {
    user: "[data-role='user'], [data-message-author-role='user'], [class*='user-message']",
    ai: "[data-role='assistant'], [data-message-author-role='assistant'], .markdown",
  };

  const clean = (s) => (s || "").replace(/[ \t]+/g, " ").replace(/ ?\n\s*/g, "\n").trim().slice(0, MAX_TEXT);
  const before = (a, b) => Boolean(a.compareDocumentPosition(b) & 4); // b follows a

  /** Last AI answer and the user message right before it; null when the page shows neither. */
  function extractLastTurn(doc, host) {
    const site = SITES[host] || GENERIC;
    const answers = [...doc.querySelectorAll(site.ai)];
    const answer = answers[answers.length - 1];
    if (!answer) return null;
    const asks = [...doc.querySelectorAll(site.user)].filter((u) => before(u, answer));
    const question = asks[asks.length - 1];
    const turn = { question: clean(question && question.textContent), answer: clean(answer.textContent) };
    return turn.answer ? turn : null;
  }

  /** The request body for POST /api/v1/mind-ledger/entries. Throws when the user gave no question. */
  function toEntry(turn, choice, clientId) {
    if (!HELP[choice.help]) throw new Error("help must be hint, approach or answer");
    const question = clean(choice.question || turn.question);
    if (!question) throw new Error("question is empty");
    return {
      client_id: clientId,
      source: "extension",
      question,
      answer: clean(turn.answer),
      help_level: choice.help,
      own_idea: clean(choice.ownIdea),
      topic: clean(choice.topic).slice(0, 80),
    };
  }

  const api = { extractLastTurn, toEntry, SITES, HELP, MAX_TEXT };
  root.MindCapture = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
