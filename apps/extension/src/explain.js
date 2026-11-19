// 讲给我听 after 记一笔: turns the server's reply to one round into what the panel shows. Pure, no DOM or network,
// so node tests can check the wording. No scores: each point is 通过, 需补充 or 待复核, and the end says what happens next.
(function (root) {
  "use strict";

  const STATE = { ok: "通过", more: "需补充", review: "待复核" };
  const RESULT = {
    clean: "讲清楚了。手机上按时间再还一次就行。",
    followed: "补充后讲清楚了。手机上会早一点来还。",
    unsure: "有几处我拿不准，手机上还账时再确认。",
    failed: "这次没讲出来，记成「讲不出来」，手机上会先排它。",
  };
  const WEIGHT = { light: "轻", medium: "中", heavy: "重" };

  /** What the panel shows for one reply of POST /entries/{id}/explain. `before` is the weight when it was booked. */
  function describe(reply, before) {
    const points = reply.points.map((p, i) => ({ n: i + 1, state: STATE[p.state], text: p.text || "" }));
    const said = reply.points.filter((p) => p.state === "ok").length;
    const progress = `第 ${reply.round} 轮 · 讲到 ${said}/${reply.points.length} 个要点`;
    if (!reply.done) return { progress, points, ask: reply.ask, done: false };
    const heavier = reply.weight && reply.weight !== before
      ? `用了提示，这笔账记成「${WEIGHT[reply.weight]}」。` : "";
    return { progress, points, ask: "", done: true, verdict: RESULT[reply.result] + heavier };
  }

  const api = { describe, STATE, RESULT };
  root.MindExplain = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
