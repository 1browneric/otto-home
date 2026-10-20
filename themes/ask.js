/* Ask Otto, the box on the OttoOS Otto tab (helper module, loaded before v3.js through
   "needs" in themes/list.js). window.OttoAsk.card(snapshot, api) returns one card:
   the last exchanges (newest at bottom; the last 3 shown, the rest behind "Earlier"),
   then the text box and Send. Status is a word, the v3 way (no icons or shapes); a failed answer
   is plain words. An exchange from an earlier Chicago day carries its written
   day with the time ("Sunday, October 18, 7:45 AM"); today's carry the time only.
   Rendering only: every read and write goes through api.ask (app.js); text nodes only. */
(function () {
  "use strict";
  if (!window.OttoHome) return;

  var SHOWN = 3;
  var ui = { all: false };

  function status(api, kind, word) {
    return api.h("span.v-status.v-s-" + kind, null, api.h("span", null, word));
  }
  function lines(api, text) {
    return String(text || "").split(/\n/).filter(function (x) { return x.trim(); }).map(function (x) {
      return api.h("div.a-line", null, x);
    });
  }
  // When an exchange was asked: the time today, the written day and time on any other day.
  function when(api, ts) {
    var t = api.fmtTime(ts);
    if (!t || api.dayKey(ts) === api.dayKey(new Date(Date.now()))) return t;
    return api.fmtDay(ts) + ", " + t;
  }
  function exchange(api, r, last) {
    var ask = api.ask, body;
    if (r.status === "answered") body = api.h("div.a-a", null, lines(api, r.answer));
    else if (r.status === "failed") body = api.h("div.a-a", null, api.h("div.a-line.a-fail", null, "Otto could not answer that - try again"));
    else if (!ask.inHours()) body = api.h("div.a-a", null, status(api, "dark", "Waiting"));
    else body = api.h("div.a-a", null, status(api, "run", "Otto is thinking"),
      last && ask.stopped() ? api.h("button.v-link.a-check", { type: "button", on: { click: ask.check } }, "Check again") : null);
    var at = when(api, r.ts), today = at === api.fmtTime(r.ts);
    var q = api.h("div.a-q-text", null, r.text);
    return api.h("div.a-ex", null,
      today ? api.h("div.a-q", null, q, api.h("div.a-q-t.v-num", null, at))
        : api.h("div.a-q.a-old", null, api.h("div.a-q-t.a-q-day.v-num", null, at), q),
      body);
  }
  function card(s, api) {
    var ask = api.ask;
    if (!ask) return null;
    var rows = ask.rows(), pending = ask.pending(), busy = ask.sending() || pending;
    var shown = ui.all ? rows : rows.slice(-SHOWN), hidden = rows.length - shown.length;
    var box = api.h("textarea.a-text", {
      id: "ask-text", rows: "2", maxlength: String(ask.MAX), autocomplete: "off", enterkeyhint: "send",
      "aria-label": "Question for Otto", placeholder: "Question or request",
      on: {
        input: function (e) { ask.draft(e.target.value); },
        keydown: function (e) {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy) ask.send(e.target.value); }
        }
      }
    });
    box.value = ask.draft();
    var send = api.h("button.v-btn.v-primary.a-send", { type: "button", disabled: busy ? true : null,
      on: { click: function () { ask.send(box.value); } } }, ask.sending() ? "Sending" : "Send");
    var night = pending && !ask.inHours();
    return api.h("section.v-card.a-card", { "aria-label": "Ask Otto" },
      api.h("div.v-card-head", null, api.h("h2.v-label", null, "Ask Otto"),
        hidden > 0 ? api.h("button.v-link", { type: "button", on: { click: function () { ui.all = true; api.render(); } } }, "Earlier " + hidden)
          : ui.all && rows.length > SHOWN ? api.h("button.v-link", { type: "button", on: { click: function () { ui.all = false; api.render(); } } }, "Fewer") : null),
      rows.length ? api.h("div.a-thread", null, shown.map(function (r, i) { return exchange(api, r, i === shown.length - 1); })) : null,
      api.h("div.a-form", null, box, send),
      night ? api.h("div.a-note", null, "Otto answers from 6 AM") : null,
      ask.error() ? api.h("div.a-note.v-amber", null, ask.error()) : null);
  }

  window.OttoAsk = { card: card };
})();
