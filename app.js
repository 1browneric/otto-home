/* Otto Home - the phone app over Otto's snapshot.
   Static shell. The only network target is the Apps Script /exec URL entered
   once; no URL, key or data is compiled into this file. ?demo=1 renders the local
   sample-snapshot.json and never contacts /exec. */
(function () {
  "use strict";

  var TZ = "America/Chicago";
  var STALE_MIN = 30;
  var VERBS = ["approve", "deny", "snooze", "done", "undo"];
  var VERB_LABEL = { approve: "Approve", deny: "Deny", snooze: "Snooze", done: "Done", undo: "Undo" };
  var K = {
    exec: "otto-home.exec", key: "otto-home.key", snap: "otto-home.snapshot",
    sent: "otto-home.sent", tab: "otto-home.tab"
  };
  var TABS = [
    { id: "needs", short: "Needs You", title: "Needs You" },
    { id: "working", short: "Working", title: "Otto working" },
    { id: "built", short: "Built", title: "Everything built" },
    { id: "domains", short: "Domains", title: "Life domains" },
    { id: "timeline", short: "Timeline", title: "Timeline" }
  ];
  var STATES = {
    live: "Live", dark: "Dark", dormant: "Dormant", retired: "Retired",
    running: "Running", needs_you: "Needs you", dry_run: "Dry run"
  };
  var OPS = {
    "event.copy": "Copy event", "event.create": "Create event", "task.create": "Create task",
    "gmail.send": "Send email", "gmail.label": "Label email", "gmail.archive": "Archive email",
    "rsvp": "RSVP", "watch.create": "Start watcher", "goal.step": "Goal step"
  };

  var params = new URLSearchParams(location.search);
  var DEMO = params.get("demo") === "1";

  /* ---------- storage, always inside try/catch ---------- */
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* none */ } },
    json: function (k) { try { var v = store.get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  };

  var state = {
    snap: null, offline: false, error: null, loading: false,
    tab: null, sent: (DEMO ? null : store.json(K.sent)) || {}, signin: null, reasons: {}
  };

  /* ---------- DOM helper: text only, never innerHTML of data ---------- */
  function h(tag, attrs) {
    var parts = tag.split("."), el = document.createElement(parts[0] || "div");
    if (parts.length > 1) el.className = parts.slice(1).join(" ");
    if (attrs) {
      Object.keys(attrs).forEach(function (a) {
        var v = attrs[a];
        if (v == null || v === false) return;
        if (a === "on") Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
        else if (a === "cls") el.className += " " + v;
        else el.setAttribute(a, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function mount(el) {
    var args = Array.prototype.slice.call(arguments, 1);
    while (el.firstChild) el.removeChild(el.firstChild);
    add(el, args);
  }

  /* ---------- formatting ---------- */
  function d(v) { var x = v ? new Date(v) : null; return x && !isNaN(x) ? x : null; }
  function fmtTime(v) {
    var x = d(v); if (!x) return "";
    return x.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  }
  function fmtDay(v) {
    var x = d(v); if (!x) return "";
    return x.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
  }
  function fmtDayOnly(s) { // "2026-10-24" -> Saturday, October 24
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return s || "";
    var x = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    return x.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  }
  function fmtWhen(v) { var x = d(v); return x ? fmtDay(x) + " at " + fmtTime(x) : (v || ""); }
  function dayKey(v) {
    var x = d(v); if (!x) return "";
    return x.toLocaleDateString("en-CA", { timeZone: TZ });
  }
  function ago(v) {
    var x = d(v); if (!x) return null;
    var m = Math.max(0, Math.round((Date.now() - x.getTime()) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var hr = Math.floor(m / 60), rem = m % 60;
    if (hr < 24) return hr + " hr" + (rem ? " " + rem + " min" : "") + " ago";
    var dd = Math.floor(hr / 24);
    return dd + (dd === 1 ? " day" : " days") + " ago";
  }
  function minutesOld(v) { var x = d(v); return x ? (Date.now() - x.getTime()) / 60000 : Infinity; }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function nameOf(id) {
    var s = state.snap, n = null;
    if (!id) return "";
    if (s && s.org) {
      (s.org.departments || []).forEach(function (dp) {
        if (dp.lead === id) n = dp.lead_name || n;
        (dp.members || []).forEach(function (m) { if (m.id === id) n = m.name || n; });
      });
      (s.org.domains || []).forEach(function (dm) { if (dm.owner === id) n = dm.owner_name || n; });
    }
    return n || cap(id);
  }

  /* ---------- shapes ---------- */
  function st(stateId, label) {
    var known = Object.prototype.hasOwnProperty.call(STATES, stateId);
    return h("span.st", null, h("span.shape." + (known ? stateId : "unknown"), { "aria-hidden": "true" }),
      label || STATES[stateId] || cap(stateId || "unknown"));
  }
  function legend(ids) {
    var seen = {};
    var list = ids.filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; });
    var order = Object.keys(STATES);
    list.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    return h("div.legend", { "aria-label": "Legend" }, list.map(function (x) { return st(x); }));
  }
  function kv(rows) {
    var g = h("div.kv");
    rows.forEach(function (r) {
      if (r == null || r[1] == null || r[1] === "" || (Array.isArray(r[1]) && !r[1].length)) return;
      var v = Array.isArray(r[1]) ? r[1].join(", ") : r[1];
      add(g, [h("div.k", null, r[0]), h("div.v" + (r[2] ? "." + r[2] : ""), null, v)]);
    });
    return g;
  }

  /* ---------- tick latency ---------- */
  function hm(s, dflt) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(s || dflt);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  function centralMinutes(x) {
    var p = x.toLocaleTimeString("en-US", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" });
    var m = /(\d+):(\d+)/.exec(p);
    return m ? ((+m[1]) % 24) * 60 + (+m[2]) : 0;
  }
  function clock(mins) {
    var hh = Math.floor(mins / 60) % 24, mm = mins % 60;
    var ap = hh >= 12 ? "PM" : "AM", h12 = hh % 12 || 12;
    return h12 + ":" + (mm < 10 ? "0" : "") + mm + " " + ap;
  }
  function tickInfo() {
    var t = (state.snap && state.snap.tick) || {};
    return {
      cadence: +t.cadence_min || 30,
      lastEvening: hm(t.last_evening, "21:30"),
      firstMorning: hm(t.first_morning, "06:00"),
      last: t.last
    };
  }
  function latency(at) {
    var ti = tickInfo(), when = at ? new Date(at) : new Date();
    var mins = centralMinutes(when);
    if (mins >= ti.lastEvening || mins < ti.firstMorning) {
      return { phrase: "in the morning", about: "About " + clock(ti.firstMorning) };
    }
    var last = d(ti.last), next;
    if (last) {
      next = new Date(last.getTime());
      while (next <= when) next = new Date(next.getTime() + ti.cadence * 60000);
      return { phrase: "on the next tick", about: "About " + fmtTime(next) };
    }
    return { phrase: "on the next tick", about: "Within " + ti.cadence + " min" };
  }
  function sentLines(r) {
    var l = latency(r.at);
    return [
      h("div.status-line", null, (r.ok ? "Sent" : "Sending") + " - " + VERB_LABEL[r.action] + " - applies " + l.phrase),
      h("div.note", null, l.about)
    ];
  }

  /* ---------- credentials ---------- */
  function creds() {
    var exec = store.get(K.exec), key = store.get(K.key);
    return exec && key ? { exec: exec, key: key } : null;
  }
  function forget(msg) {
    store.del(K.key); store.del(K.snap); store.del(K.sent);
    state.snap = null; state.sent = {};
    showSignIn(msg);
  }
  function isBadKey(j) { return j && (j.error === "bad_key" || j.error === "key"); }

  /* ---------- loading ---------- */
  function rebaseDemo(s) {
    // Move the sample to today: whole days only, so clock times stay as written.
    // Then the snapshot reads 4 minutes old and the last tick is the latest half hour.
    var g = d(s.generated); if (!g) return s;
    var today = new Date(dayKey(new Date()) + "T12:00:00Z"), then = new Date(dayKey(g) + "T12:00:00Z");
    var delta = Math.round((today - then) / 86400000) * 86400000;
    var re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
    (function walk(o) {
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (typeof v === "string" && re.test(v)) o[k] = new Date(new Date(v).getTime() + delta).toISOString();
        else if (v && typeof v === "object") walk(v);
      });
    })(s);
    var now = Date.now();
    s.generated = new Date(now - 4 * 60000).toISOString();
    if (s.tick) s.tick.last = new Date(Math.floor((now - 4 * 60000) / 1800000) * 1800000).toISOString();
    return s;
  }
  function valid(j) { return j && typeof j === "object" && j.v === 1 && typeof j.generated === "string"; }

  function load() {
    if (DEMO) {
      state.loading = true; render();
      return fetch("sample-snapshot.json", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("missing"); return r.json(); })
        .then(function (j) { state.snap = rebaseDemo(j); state.error = null; })
        .catch(function () { state.error = "Demo data not found"; })
        .then(function () { state.loading = false; pickTab(); render(); });
    }
    var c = creds();
    if (!c) { showSignIn(); return Promise.resolve(); }
    if (!state.snap) state.snap = store.json(K.snap);
    state.loading = true; render();
    return fetch(c.exec + (c.exec.indexOf("?") >= 0 ? "&" : "?") + "k=" + encodeURIComponent(c.key),
      { method: "GET", redirect: "follow", cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        state.offline = false;
        if (isBadKey(j)) { forget("Key not accepted"); return; }
        if (j && j.error) { state.error = j.error; return; }
        if (!valid(j)) { state.error = "Unreadable snapshot"; return; }
        state.error = null; state.snap = j;
        store.set(K.snap, JSON.stringify(j));
        pruneSent();
      })
      .catch(function () { state.offline = true; })
      .then(function () { state.loading = false; if (!state.signin) { pickTab(); render(); } });
  }

  /* ---------- writes ---------- */
  function saveSent() { if (!DEMO) store.set(K.sent, JSON.stringify(state.sent)); }
  // A tap shows as Sent until the snapshot proves otherwise. When the item is still
  // pending and the snapshot reports the tap refused or failed, or is newer than the
  // tap by more than one fast-job pass (6 min), the buttons come back with a reason.
  var PASS_MS = 6 * 60000;
  var REASON = { refused: "Not applied", failed: "Failed" };
  function pruneSent() {
    var s = state.snap, live = {}, pending = {}, outcomes = (s && s.outcomes) || {};
    if (!s) return;
    var gen = d(s.generated);
    (s.needs_you || []).forEach(function (i) { live[i.id] = 1; pending[i.id] = 1; });
    (s.added_today || []).forEach(function (i) { live[i.id] = 1; });
    Object.keys(state.sent).forEach(function (id) {
      var r = state.sent[id];
      var old = minutesOld(r.at) > 36 * 60;
      if (old || (!live[id] && r.ok)) { delete state.sent[id]; return; }
      if (!pending[id] || !r.ok) return;
      var o = outcomes[id], at = d(r.at), oAt = o && d(o.at);
      if (o && o.result !== "ok" && oAt && at && oAt >= at) {
        state.reasons[id] = (REASON[o.result] || "Not applied") + (o.reason ? " - " + o.reason : "");
        delete state.sent[id];
      } else if (gen && at && gen.getTime() - at.getTime() > PASS_MS) {
        state.reasons[id] = "Not applied yet - tap again";
        delete state.sent[id];
      }
    });
    saveSent();
  }
  function send(id, action, token) {
    if (VERBS.indexOf(action) < 0) return;
    var rec = { action: action, at: new Date().toISOString(), ok: null, token: token };
    delete state.reasons[id];
    state.sent[id] = rec; render();
    if (DEMO) { rec.ok = true; render(); return; }
    var c = creds();
    if (!c) { showSignIn(); return; }
    fetch(c.exec, {
      method: "POST",
      body: JSON.stringify({ k: c.key, action: action, id: id, token: token }),
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      redirect: "follow", credentials: "omit"
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (isBadKey(j)) { forget("Key not accepted"); return; }
        if (j && j.ok) { rec.ok = true; rec.err = null; }
        else { rec.ok = false; rec.err = (j && j.error) || "Not accepted"; }
      })
      .catch(function () { rec.ok = false; rec.err = "Offline"; })
      .then(function () { saveSent(); if (!state.signin) render(); });
  }

  /* ---------- tab choice ---------- */
  function pendingItems() {
    return ((state.snap && state.snap.needs_you) || []);
  }
  function unsentCount() {
    return pendingItems().filter(function (i) { var r = state.sent[i.id]; return !r || r.ok === false; }).length;
  }
  function pickTab() {
    var hash = (location.hash || "").replace("#", "");
    if (TABS.some(function (t) { return t.id === hash; })) { state.tab = hash; return; }
    if (state.tab) return;
    if (unsentCount() > 0) { state.tab = "needs"; return; }
    var saved = store.get(K.tab);
    state.tab = TABS.some(function (t) { return t.id === saved; }) ? saved : "working";
  }
  function go(id) {
    state.tab = id; store.set(K.tab, id);
    try { history.replaceState(null, "", location.pathname + location.search + "#" + id); } catch (e) { /* none */ }
    render(); window.scrollTo(0, 0);
  }

  /* ---------- render ---------- */
  var $top = document.getElementById("top");
  var $view = document.getElementById("view");
  var $tabs = document.getElementById("tabs");

  function render() {
    if (state.signin) return;
    $top.hidden = false; $tabs.hidden = false;
    renderTop(); renderTabs();
    if (!state.snap) {
      mount($view, h("div.empty", null, state.loading ? "Loading" : (state.error || (state.offline ? "Offline, no saved snapshot" : "No snapshot yet"))));
      return;
    }
    var fn = { needs: viewNeeds, working: viewWorking, built: viewBuilt, domains: viewDomains, timeline: viewTimeline }[state.tab] || viewWorking;
    mount($view, fn(state.snap));
  }

  function freshness() {
    var g = state.snap && state.snap.generated;
    if (!g) return { text: "No snapshot yet", stale: false };
    var stale = minutesOld(g) > STALE_MIN;
    return { text: (stale ? "Stale - updated " : "Updated ") + ago(g), stale: stale };
  }
  function renderTop() {
    var f = freshness();
    var sub = DEMO ? "Demo" : state.loading ? "Refreshing" : state.offline ? "Offline - last snapshot" : state.error ? "Error: " + state.error : null;
    mount($top,
      h("div.fresh", null,
        h("div.fresh-line" + (f.stale ? ".stale" : ""), null, f.text),
        sub ? h("div.sub", null, sub) : null),
      h("button.btn.small", { type: "button", on: { click: function () { load(); } } }, "Refresh"));
  }
  function renderTabs() {
    var n = unsentCount();
    mount($tabs, TABS.map(function (t) {
      return h("button.tab" + (state.tab === t.id ? ".on" : ""), {
        type: "button", "aria-current": state.tab === t.id ? "page" : null,
        on: { click: function () { go(t.id); } }
      }, t.short, t.id === "needs" && n ? h("span.badge", null, " " + n) : null);
    }));
  }

  /* Needs You */
  function whyRows(w) {
    if (!w) return [];
    if (typeof w === "string") return [["Why", w]];
    var rows = [];
    if (w.text) rows.push(["Why", w.text]);
    if (w.rule) rows.push(["Rule", w.rule]);
    if (w.watcher) rows.push(["Watcher", w.watcher]);
    if (w.goal) rows.push(["Goal", w.goal]);
    if (w.step) rows.push(["Step", w.step]);
    return rows;
  }
  function effectRows(e) {
    if (!e) return [];
    return [
      ["Effect", e.summary || OPS[e.op] || e.op],
      ["Calendar", e.calendar],
      ["List", e.list],
      ["To", e.recipients],
      ["Subject", e.subject],
      ["When", e.when_text || (e.start ? fmtWhen(e.start) + (e.end ? " to " + fmtTime(e.end) : "") : null)],
      ["Where", e.location],
      ["Title", e.title],
      ["Due", e.due ? fmtDayOnly(e.due) : null],
      ["Copies", e.fields],
      ["Wording", e.wording, "quote"]
    ];
  }
  function needsCard(it) {
    var r = state.sent[it.id];
    var rows = [["Type", cap(it.type)], ["Lead", nameOf(it.lead)], ["Agent", nameOf(it.agent)]]
      .concat(effectRows(it.effect)).concat(whyRows(it.why))
      .concat([["Priority", it.priority != null ? String(it.priority) + (it.decide_today ? " - decide today" : "") : null],
        ["Expires", it.expires ? fmtWhen(it.expires) : null]]);
    var body = [st("needs_you"), h("h2", null, it.title), kv(rows)];
    if (r && r.ok !== false) {
      body = body.concat(sentLines(r));
      return h("div.card.sent", { "data-id": it.id }, body);
    }
    if (r && r.ok === false) body.push(h("div.status-line", null, "Not sent - " + r.err));
    else if (!r && state.reasons[it.id]) body.push(h("div.status-line", null, state.reasons[it.id]));
    var acts = (it.actions && it.actions.length ? it.actions : ["approve", "deny", "snooze"]).filter(function (a) { return VERBS.indexOf(a) >= 0 && a !== "undo"; });
    body.push(h("div.actions", null, acts.map(function (a) {
      var tok = (it.tokens && it.tokens[a]) || it.token || "";
      return h("button.btn" + (a === "approve" ? ".primary" : a === "snooze" ? ".teal" : ""), {
        type: "button", on: { click: function () { send(it.id, a, tok); } }
      }, VERB_LABEL[a]);
    })));
    return h("div.card" + (r && r.ok === false ? ".err" : ""), { "data-id": it.id }, body);
  }
  function addedCard(it) {
    var r = state.sent[it.id];
    var rows = [["Lead", nameOf(it.lead)], ["Agent", nameOf(it.agent)], ["Added", it.at ? fmtTime(it.at) : null],
      ["Undo until", it.undo_until ? fmtWhen(it.undo_until) : null]];
    var body = [h("div", null, it.title), kv(rows)];
    if (r && r.ok !== false) {
      body = body.concat(sentLines(r));
      return h("div.card.sent", null, body);
    }
    if (r && r.ok === false) body.push(h("div.status-line", null, "Not sent - " + r.err));
    var expired = it.undo_until && minutesOld(it.undo_until) > 0;
    if (it.undo_token && !expired) {
      body.push(h("div.actions", null, h("button.btn.small", {
        type: "button", on: { click: function () { send(it.id, "undo", it.undo_token); } }
      }, "Undo")));
    }
    return h("div.card", null, body);
  }
  function viewNeeds(s) {
    var items = pendingItems().slice().sort(function (a, b) {
      return (a.decide_today ? 0 : 1) - (b.decide_today ? 0 : 1) || (a.priority || 9) - (b.priority || 9);
    });
    var added = s.added_today || [];
    var n = unsentCount();
    var ti = tickInfo();
    return [
      h("h1", null, "Needs You"),
      h("div.count", null, n + " pending" + (items.length - n ? ", " + (items.length - n) + " sent" : "")),
      h("div.note", null, "Taps apply on the next tick; after " + clock(ti.lastEvening) + ", in the morning"),
      items.length ? items.map(needsCard) : h("div.empty", null, "Nothing pending"),
      h("h3", null, "Added today"),
      added.length ? added.map(addedCard) : h("div.empty", null, "Nothing added today")
    ];
  }

  /* Otto working */
  function viewWorking(s) {
    var t = s.tick || {}, w = s.working || {};
    var f = freshness();
    var states = (w.agent_states || []);
    var gates = s.gates || [];
    var ks = s.kill_switch;
    var ti = tickInfo();
    return [
      h("h1", null, "Otto working"),
      h("div.card", null, kv([
        ["Snapshot", f.text],
        ["Last tick", t.last ? fmtWhen(t.last) : null],
        ["Cadence", ti.cadence + " min"],
        ["Evening", "Last tick " + clock(ti.lastEvening)],
        ["Morning", "First tick " + clock(ti.firstMorning)],
        ["Time to clear", w.time_to_clear_7d_min != null ? w.time_to_clear_7d_min + " min, 7-day average" : null],
        ["Flex days", w.flex_used_7d != null ? w.flex_used_7d + " of " + (w.flex_max_7d || 2) + " this week" : null]
      ])),
      h("h3", null, "Ran this tick"),
      h("div.card", null, (t.ran_this_tick || []).length
        ? h("ul.list", null, t.ran_this_tick.map(function (a) { return h("li", null, h("span.grow", null, nameOf(a))); }))
        : h("div.empty", null, "Nothing")),
      h("h3", null, "Ran today"),
      h("div.card", null, (t.ran_today || []).length
        ? h("ul.list", null, t.ran_today.map(function (a) {
          var id = typeof a === "string" ? a : a.agent;
          return h("li", null, h("span.grow", null, nameOf(id)), a.runs != null ? h("span.right", null, a.runs + (a.runs === 1 ? " run" : " runs")) : null);
        }))
        : h("div.empty", null, "Nothing")),
      h("h3", null, "Active workers"),
      h("div.card", null, (w.workers || []).length
        ? h("ul.list", null, w.workers.map(function (x) {
          return h("li", null, st("running", ""), h("span.grow", null, nameOf(x.id) + (x.task ? " - " + x.task : "")),
            x.since ? h("span.right", null, fmtTime(x.since)) : null);
        }))
        : h("div.empty", null, "None")),
      h("h3", null, "Agents"),
      legend(states.map(function (x) { return x.state; }).concat((w.workers || []).length ? ["running"] : [])),
      h("div.card", null, h("ul.list", null, states.map(function (x) {
        return h("li", null, h("span.grow", null, x.name || nameOf(x.id)), st(x.state));
      }))),
      h("h3", null, "Gates"),
      legend(gates.map(function (g) { return g.state; })),
      h("div.card", null, h("ul.list", null, gates.map(function (g) {
        return h("li", null, h("span.grow", null, g.name), st(g.state));
      }).concat(ks ? [h("li", null, h("span.grow", null, ks.name), h("span.right", null, ks.on ? "Memory on" : "Memory off"))] : []))),
      h("div.note", null, "Read-only")
    ];
  }

  /* Everything built */
  function viewBuilt(s) {
    var org = s.org || {}, deps = org.departments || [], doms = org.domains || [], used = [];
    deps.forEach(function (dp) { used.push(dp.lead_state); (dp.members || []).forEach(function (m) { used.push(m.state); }); });
    doms.forEach(function (dm) { used.push(dm.owner_state); });
    return [
      h("h1", null, "Everything built"),
      legend(used),
      h("h3", null, "Departments"),
      deps.map(function (dp) {
        return h("div.card", null,
          h("h2", null, dp.name),
          h("div.org-lead", null, h("span", null, "Lead: " + (dp.lead_name || nameOf(dp.lead))), st(dp.lead_state)),
          (dp.members || []).length ? h("ul.org-members", null, dp.members.map(function (m) {
            return h("li", null, h("span", null, m.name || nameOf(m.id)), st(m.state));
          })) : null);
      }),
      h("h3", null, "Life domains"),
      doms.map(function (dm) {
        return h("div.card", null,
          h("h2", null, dm.name),
          h("div.org-lead", null, h("span", null, "Owner: " + (dm.owner_name || nameOf(dm.owner))), st(dm.owner_state)));
      })
    ];
  }

  /* Life domains */
  function viewDomains(s) {
    var doms = s.domains || [], cl = s.clinical;
    var used = [];
    doms.forEach(function (dm) { (dm.watchers || []).forEach(function (w) { used.push(w.state); }); });
    var out = [h("h1", null, "Life domains")];
    if (used.length) out.push(legend(used));
    if (cl) {
      out.push(h("div.card", null, h("h2", null, "Clinical"), kv([
        ["Events today", cl.events_today == null ? "not read" : String(cl.events_today)],
        ["Times", cl.times || []]
      ])));
    }
    doms.forEach(function (dm) {
      var goals = dm.goals || [], watchers = dm.watchers || [], dates = (dm.dates || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      out.push(h("div.card", null,
        h("h2", null, dm.name),
        kv([["Owner", dm.owner_name || nameOf(dm.owner || dm.id)]]),
        h("h3", null, "Goals"),
        goals.length ? goals.map(function (g) {
          return h("div", null, h("div", null, g.title),
            (g.next || []).length ? h("ul.list", null, g.next.map(function (n) { return h("li", null, h("span.grow", null, "Next: " + n)); })) : null);
        }) : h("div.empty", null, "None"),
        h("h3", null, "Watchers"),
        watchers.length ? h("ul.list", null, watchers.map(function (w) {
          return h("li", null, h("span.grow", null, w.title), st(w.state));
        })) : h("div.empty", null, "None"),
        h("h3", null, "Upcoming"),
        dates.length ? h("ul.list", null, dates.map(function (x) {
          return h("li", null, h("span.grow", null, x.title), h("span.right", null, fmtDayOnly(x.date)));
        })) : h("div.empty", null, "None")));
    });
    return out;
  }

  /* Timeline */
  function viewTimeline(s) {
    var rows = (s.timeline || []).slice().sort(function (a, b) { return (d(b.ts) || 0) - (d(a.ts) || 0); });
    var out = [h("h1", null, "Timeline")], last = null;
    if (!rows.length) out.push(h("div.empty", null, "No activity"));
    rows.forEach(function (e) {
      var k = dayKey(e.ts);
      if (k !== last) { out.push(h("div.day-head", null, fmtDay(e.ts))); last = k; }
      out.push(h("div.tl", null,
        h("div.when", null, fmtTime(e.ts) + (e.result ? " - " + cap(e.result) : "")),
        h("div", null, e.summary || OPS[e.action] || e.action || ""),
        kv([["Source", cap(e.source)], ["Lead", nameOf(e.lead)], ["Agent", nameOf(e.agent)]])));
    });
    return out;
  }

  /* ---------- sign-in ---------- */
  function showSignIn(msg) {
    state.signin = true;
    $top.hidden = true; $tabs.hidden = true;
    var exec = h("input", { id: "exec", type: "url", inputmode: "url", autocomplete: "off", autocapitalize: "off", spellcheck: "false", required: true, value: store.get(K.exec) || "" });
    var key = h("input", { id: "key", type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false", required: true });
    var note = h("div.msg", null, msg || "");
    var form = h("form.signin", { on: { submit: function (ev) {
      ev.preventDefault();
      var u = exec.value.trim(), k = key.value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(u)) { mount(note, "Web App URL must end in /exec"); return; }
      if (!k) { mount(note, "Key needed"); return; }
      mount(note, "Checking");
      fetch(u + "?k=" + encodeURIComponent(k), { redirect: "follow", cache: "no-store", credentials: "omit" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (isBadKey(j)) { mount(note, "Key not accepted"); return; }
          if (j && j.error && j.error !== "no_snapshot") { mount(note, "Error: " + j.error); return; }
          if (store.get(K.exec) !== u || store.get(K.key) !== k) { store.del(K.snap); store.del(K.sent); state.sent = {}; }
          if (!store.set(K.exec, u) || !store.set(K.key, k)) { mount(note, "This browser will not save the key"); return; }
          state.signin = null; state.snap = valid(j) ? j : null;
          if (state.snap) store.set(K.snap, JSON.stringify(j));
          pickTab(); render();
        })
        .catch(function () { mount(note, "Could not reach the Web App"); });
    } } },
      h("h1", null, "Otto Home"),
      h("label", { "for": "exec" }, "Web App URL"), exec,
      h("label", { "for": "key" }, "Key"), key,
      h("button.btn.primary", { type: "submit" }, "Save"),
      note);
    mount($view, form);
  }

  /* ---------- boot ---------- */
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* none */ }
  if ("serviceWorker" in navigator) {
    try { navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () {}); } catch (e) { /* none */ }
  }
  window.addEventListener("hashchange", function () { var x = location.hash.replace("#", ""); if (TABS.some(function (t) { return t.id === x; })) { state.tab = x; render(); } });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && !state.signin && !DEMO) load();
  });
  setInterval(function () {
    if (document.visibilityState !== "visible" || state.signin) return;
    if (DEMO) { render(); return; }
    load();
  }, 5 * 60000);
  setInterval(function () { if (!state.signin && state.snap) renderTop(); }, 60000);

  if (!DEMO && !creds()) showSignIn();
  else { if (!DEMO) { state.snap = store.json(K.snap); pickTab(); render(); } load(); }
})();
