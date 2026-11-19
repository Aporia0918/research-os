// Adds one floating button, 「记一笔」. Nothing is read until the user presses it, and only what the page shows.
// After the entry is booked, 讲给我听: the student explains the answer in their own words, at most three rounds.
(function () {
  "use strict";
  const { extractLastTurn, toEntry, HELP } = window.MindCapture;
  const { describe } = window.MindExplain;

  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .fab, .panel { position: fixed; right: 20px; z-index: 2147483647; font: 14px/1.5 system-ui, sans-serif; }
      .fab { bottom: 20px; border: 0; border-radius: 999px; padding: 10px 16px; color: #fff; background: #1f6f5c;
             box-shadow: 0 6px 20px rgb(0 0 0 / .18); cursor: pointer; }
      .panel { bottom: 72px; width: 320px; padding: 14px; border-radius: 14px; color: #1d2421; background: #fbfcfb;
               box-shadow: 0 12px 32px rgb(0 0 0 / .2); display: grid; gap: 8px; }
      .panel[hidden] { display: none; }
      textarea, input { font: inherit; width: 100%; box-sizing: border-box; border: 1px solid #cfd8d4;
                        border-radius: 8px; padding: 6px 8px; resize: vertical; }
      .help { display: flex; gap: 6px; }
      .help label { flex: 1; text-align: center; border: 1px solid #cfd8d4; border-radius: 8px; padding: 4px; cursor: pointer; }
      .help input { display: none; }
      .help input:checked + span { font-weight: 600; color: #1f6f5c; }
      .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .msg, .progress { font-size: 12px; color: #5b6762; min-height: 1.5em; }
      .ask, .hint { margin: 0; }
      .hint { font-size: 13px; color: #8a5a00; }
      ol { margin: 0; padding-left: 18px; font-size: 13px; }
      li b { font-weight: 600; margin-right: 4px; }
      button { font: inherit; border: 0; border-radius: 8px; padding: 6px 14px; cursor: pointer; }
      .primary { color: #fff; background: #1f6f5c; }
      .quiet { color: #1f6f5c; background: transparent; padding: 6px 4px; }
    </style>
    <button class="fab" type="button">记一笔</button>
    <form class="panel book" hidden>
      <textarea name="question" rows="2" placeholder="题目（没认出来就自己写一句）"></textarea>
      <div class="help">${Object.entries(HELP).map(([k, v]) =>
        `<label><input type="radio" name="help" value="${k}" ${k === "answer" ? "checked" : ""}><span>${v}</span></label>`).join("")}</div>
      <textarea name="ownIdea" rows="2" placeholder="问之前我自己的想法（写了就记轻一档）"></textarea>
      <input name="topic" placeholder="课程，比如 高数">
      <div class="row"><span class="msg"></span><button class="primary" type="submit">记账</button></div>
    </form>
    <form class="panel talk" hidden>
      <span class="progress">先别看上面的回答，用自己的话讲给我听</span>
      <p class="ask" hidden></p>
      <ol hidden></ol>
      <textarea name="text" rows="4" placeholder="比如：它说的是……因为……"></textarea>
      <p class="hint" hidden></p>
      <div class="row">
        <button class="quiet" type="button" data-act="hint">给点提示</button>
        <button class="quiet" type="button" data-act="skip">先不讲</button>
        <button class="primary" type="submit">讲完了</button>
      </div>
      <span class="msg"></span>
    </form>`;
  document.documentElement.append(host);

  const $ = (sel) => shadow.querySelector(sel);
  const fab = $(".fab"), book = $(".book"), talk = $(".talk");
  let turn = null, entry = null; // entry: {id, weight} once booked

  const show = (panel) => { book.hidden = panel !== book; talk.hidden = panel !== talk; };
  const send = (msg) => chrome.runtime.sendMessage(msg);

  fab.addEventListener("click", () => {
    if (!book.hidden || !talk.hidden) return show(null);
    const picked = String(window.getSelection() || "").trim();
    turn = picked ? { question: "", answer: picked } : extractLastTurn(document, location.hostname);
    book.querySelector(".msg").textContent = turn ? "" : "没认出对话，先选中 AI 的回答再点";
    book.elements.question.value = turn ? turn.question : "";
    show(book);
  });

  book.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = book.querySelector(".msg");
    if (!turn) return;
    let body;
    try {
      const help = book.querySelector("input[name=help]:checked").value;
      body = toEntry(turn, { help, question: book.elements.question.value, ownIdea: book.elements.ownIdea.value,
                             topic: book.elements.topic.value }, crypto.randomUUID());
    } catch {
      return void (msg.textContent = "先写上题目");
    }
    msg.textContent = "记账中…";
    const res = await send({ type: "record", entry: body });
    if (!res.ok) return void (msg.textContent = res.error);
    msg.textContent = "";
    entry = { id: res.id, weight: res.weight };
    startTalk();
  });

  function startTalk() {
    talk.reset();
    $(".progress").textContent = "先别看上面的回答，用自己的话讲给我听";
    for (const el of [$(".ask"), $("ol"), $(".hint")]) el.hidden = true;
    talk.elements.text.hidden = false;
    talk.querySelector("[type=submit]").hidden = talk.querySelector("[data-act=hint]").hidden = false;
    talk.querySelector("[data-act=skip]").textContent = "先不讲";
    show(talk);
  }

  function render(view) {
    $(".progress").textContent = view.progress;
    $(".ask").hidden = !view.ask && !view.verdict;
    $(".ask").textContent = view.verdict || view.ask;
    const list = $("ol");
    list.replaceChildren(...view.points.map((p) => {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = p.state;
      li.append(b, p.text);
      return li;
    }));
    list.hidden = false;
    if (view.done) {
      talk.elements.text.hidden = $(".hint").hidden = true;
      talk.querySelector("[type=submit]").hidden = talk.querySelector("[data-act=hint]").hidden = true;
      talk.querySelector("[data-act=skip]").textContent = "关上";
    }
  }

  talk.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = talk.querySelector(".msg"), text = talk.elements.text.value.trim();
    if (!text) return void (msg.textContent = "先讲一句");
    msg.textContent = "在听…";
    const res = await send({ type: "explain", id: entry.id, text });
    msg.textContent = res.ok ? "" : res.error;
    if (!res.ok) return;
    talk.elements.text.value = "";
    render(describe(res.reply, entry.weight));
  });

  talk.addEventListener("click", async (ev) => {
    const act = ev.target.dataset && ev.target.dataset.act;
    if (act === "skip") return show(null); // not explained: the debt stays as booked, repaid on the phone
    if (act !== "hint") return;
    const res = await send({ type: "hint", id: entry.id });
    const hint = $(".hint");
    hint.hidden = false;
    hint.textContent = res.ok ? res.hint.text : res.error;
  });
})();
