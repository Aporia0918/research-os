// Adds one floating button, 「记这一条」. Nothing is read until the user presses it, and only what the page shows.
(function () {
  "use strict";
  const { extractLastTurn, toEntry, HELP } = window.MindCapture;

  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .fab, .panel { position: fixed; right: 20px; z-index: 2147483647; font: 14px/1.5 system-ui, sans-serif; }
      .fab { bottom: 20px; border: 0; border-radius: 999px; padding: 10px 16px; color: #fff; background: #1f6f5c;
             box-shadow: 0 6px 20px rgb(0 0 0 / .18); cursor: pointer; }
      .panel { bottom: 72px; width: 300px; padding: 14px; border-radius: 14px; color: #1d2421; background: #fbfcfb;
               box-shadow: 0 12px 32px rgb(0 0 0 / .2); display: grid; gap: 8px; }
      textarea, input { font: inherit; width: 100%; box-sizing: border-box; border: 1px solid #cfd8d4;
                        border-radius: 8px; padding: 6px 8px; resize: vertical; }
      .help { display: flex; gap: 6px; }
      .help label { flex: 1; text-align: center; border: 1px solid #cfd8d4; border-radius: 8px; padding: 4px; cursor: pointer; }
      .help input { display: none; }
      .help input:checked + span { font-weight: 600; color: #1f6f5c; }
      .row { display: flex; justify-content: space-between; align-items: center; }
      .msg { font-size: 12px; color: #5b6762; min-height: 1.5em; }
      button.save { border: 0; border-radius: 8px; padding: 6px 14px; color: #fff; background: #1f6f5c; cursor: pointer; }
    </style>
    <button class="fab" type="button">记这一条</button>
    <form class="panel" hidden>
      <textarea name="question" rows="2" placeholder="题目（没认出来就自己写一句）"></textarea>
      <div class="help">${Object.entries(HELP).map(([k, v]) =>
        `<label><input type="radio" name="help" value="${k}" ${k === "answer" ? "checked" : ""}><span>${v}</span></label>`).join("")}</div>
      <textarea name="ownIdea" rows="2" placeholder="问之前我自己的想法（写了就记轻一档）"></textarea>
      <input name="topic" placeholder="课程，比如 高数">
      <div class="row"><span class="msg"></span><button class="save" type="submit">记账</button></div>
    </form>`;
  document.documentElement.append(host);

  const fab = shadow.querySelector(".fab");
  const form = shadow.querySelector("form");
  const msg = shadow.querySelector(".msg");
  let turn = null;

  fab.addEventListener("click", () => {
    if (!form.hidden) return void (form.hidden = true);
    const picked = String(window.getSelection() || "").trim();
    turn = picked ? { question: "", answer: picked } : extractLastTurn(document, location.hostname);
    msg.textContent = turn ? "" : "没认出对话，先选中 AI 的回答再点";
    form.question.value = turn ? turn.question : "";
    form.hidden = false;
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!turn) return;
    let entry;
    try {
      const help = form.querySelector("input[name=help]:checked").value;
      entry = toEntry(turn, { help, question: form.question.value, ownIdea: form.ownIdea.value,
                              topic: form.topic.value }, crypto.randomUUID());
    } catch {
      return void (msg.textContent = "先写上题目");
    }
    msg.textContent = "记账中…";
    const res = await chrome.runtime.sendMessage({ type: "record", entry });
    msg.textContent = res.ok ? `已记下，${res.due ? `${res.due} 来还` : "这条是你自己的，不用还"}` : res.error;
    if (res.ok) setTimeout(() => (form.hidden = true), 1500);
  });
})();
