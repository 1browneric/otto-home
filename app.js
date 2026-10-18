/* OttoOS (formerly Otto Home) - the phone app over Otto's snapshot.
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
    sent: "otto-home.sent"
  };
  // Four tabs in every theme: Home (id "today"), Lists, Activity, System.
  // Old hashes still land on the tab that now holds them.
  var TABS = [
    { id: "today", short: "Home", title: "Home" },
    { id: "lists", short: "Lists", title: "Lists" },
    { id: "activity", short: "Activity", title: "Activity" },
    { id: "system", short: "System", title: "System" }
  ];
  var OLD_TAB = { home: "today", needs: "today", working: "system", built: "system", domains: "lists", life: "lists", timeline: "activity" };
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
  var THEME_KEY = "otto-home.theme";

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
  /* ---------- schedule (begin): pure, no DOM; tests load this block on its own ----------
     The snapshot carries each agent's cron lines (UTC, as the VM runs them). nextFire is the
     next run after a moment; snapLate says whether the snapshot itself is overdue, judged
     against the orchestrator's NEXT scheduled tick (its cron lines, else the tick window),
     so the night gap after the last evening tick is never a problem. */
  var CRON_RANGE = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  function cronField(spec, lo, hi) {
    if (spec === "*") return null;
    var out = {};
    spec.split(",").forEach(function (part) {
      var bits = part.split("/"), rng = bits[0], step = bits[1] ? +bits[1] : 1, a, b;
      if (rng === "*") { a = lo; b = hi; }
      else if (rng.indexOf("-") >= 0) { a = +rng.split("-")[0]; b = +rng.split("-")[1]; }
      else { a = +rng; b = bits[1] ? hi : a; }
      for (var x = a; x <= b; x += step) out[hi === 6 && x === 7 ? 0 : x] = 1;
    });
    return out;
  }
  function cronSpecs(lines) {
    return (lines || []).map(function (ln) {
      var f = String(ln).split(/\s+/);
      if (f.length !== 5) return null;
      return f.map(function (x, i) { return cronField(x, CRON_RANGE[i][0], CRON_RANGE[i][1]); });
    }).filter(Boolean);
  }
  function cronHas(set, v) { return set === null || !!set[v]; }
  function cronList(set, lo, hi) { var o = []; for (var x = lo; x <= hi; x++) if (cronHas(set, x)) o.push(x); return o; }
  function cronDay(sp, day) { // day: a Date at 00:00 UTC
    if (!cronHas(sp[3], day.getUTCMonth() + 1)) return false;
    var domOk = cronHas(sp[2], day.getUTCDate()), dowOk = cronHas(sp[4], day.getUTCDay());
    return sp[2] !== null && sp[4] !== null ? domOk || dowOk : domOk && dowOk;
  }
  // The first run strictly after fromMs (a Date), or null.
  function nextFire(lines, fromMs) {
    var specs = cronSpecs(lines), best = null, base = Math.floor(+fromMs / 60000) * 60000;
    specs.forEach(function (sp) {
      var hrs = cronList(sp[1], 0, 23), mins = cronList(sp[0], 0, 59);
      for (var n = 0; n < 9; n++) {
        var d0 = new Date(Math.floor(base / 86400000) * 86400000 + n * 86400000);
        if (!cronDay(sp, d0)) continue;
        var hit = null;
        for (var i = 0; i < hrs.length && !hit; i++) for (var j = 0; j < mins.length; j++) {
          var t = d0.getTime() + hrs[i] * 3600000 + mins[j] * 60000;
          if (t > base) { hit = t; break; }
        }
        if (hit) { if (best === null || hit < best) best = hit; break; }
      }
    });
    return best === null ? null : new Date(best);
  }
  function ctMinutes(x) {
    var p = x.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour12: false, hour: "2-digit", minute: "2-digit" });
    var m = /(\d+):(\d+)/.exec(p);
    return m ? ((+m[1]) % 24) * 60 + (+m[2]) : 0;
  }
  // When the next snapshot is due: the orchestrator's next cron tick after the snapshot.
  function nextSnapshot(s) {
    var g = s && s.generated ? new Date(s.generated) : null;
    if (!g || isNaN(g)) return null;
    var rows = ((s.agents_runs || {}).rows) || [], orch = null;
    rows.forEach(function (r) { if (r && r.id === "otto-orch" && r.cron && r.cron.length) orch = r; });
    if (orch) return nextFire(orch.cron, g.getTime());
    var t = s.tick || {}, cad = +t.cadence_min || 30;
    var hmOf = function (v) { var m = /^(\d{1,2}):(\d{2})$/.exec(v || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
    var last = hmOf(t.last_evening), first = hmOf(t.first_morning), now = ctMinutes(g);
    if (last != null && first != null && now >= last) return new Date(g.getTime() + (24 * 60 - now + first) * 60000);
    if (last != null && first != null && now < first) return new Date(g.getTime() + (first - now) * 60000);
    return new Date(g.getTime() + cad * 60000);
  }
  // True when the next scheduled snapshot is more than graceMin overdue at nowMs.
  function snapLate(s, nowMs, graceMin) {
    var due = nextSnapshot(s);
    if (!due) return false;
    return +nowMs > due.getTime() + (graceMin == null ? 30 : graceMin) * 60000;
  }
  /* ---------- schedule (end) ---------- */

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
  function applyPhrase(at) {
    var mins = centralMinutes(at ? new Date(at) : new Date());
    return (mins >= 22 * 60 || mins < 6 * 60 + 4) ? "applies about 6:05 AM" : "applies within 5 minutes";
  }
  var DONE_WORD = { approve: "Approved", deny: "Denied", snooze: "Snoozed", done: "Done", undo: "Undo sent" };

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
  // ?demo=1&problem=1 adds the sample's one failed action (demo_problem) so the health line
  // has something to show. The entry lives in the data, so the shell names no agent.
  function demoProblem(s) {
    var p = s.demo_problem;
    if (params.get("problem") !== "1" || !p) return s;
    var e = {};
    Object.keys(p).forEach(function (k) { if (k !== "minutes_ago") e[k] = p[k]; });
    e.ts = new Date(Date.now() - (p.minutes_ago || 0) * 60000).toISOString();
    (s.timeline = s.timeline || []).unshift(e);
    return s;
  }
  function valid(j) { return j && typeof j === "object" && j.v === 1 && typeof j.generated === "string"; }

  function load() {
    if (DEMO) {
      state.loading = true; render();
      return fetch("sample-snapshot.json", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("missing"); return r.json(); })
        .then(function (j) { state.snap = demoProblem(rebaseDemo(j)); state.error = null; askDemo(state.snap); })
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
      .then(function () { state.loading = false; if (!state.signin) { pickTab(); render(); askLoad(); } });
  }

  /* ---------- Ask Otto ----------
     The thread lives in the Asks tab of the Apps Script sheet. Send posts
     {k, kind:"ask", text} with the same key as a tap; the VM answers within about
     1-2 minutes (agents/otto/ask). While the newest ask is pending the app reads
     ?kind=asks every 10 s, and stops when it is answered or after 5 minutes.
     ?demo=1 never contacts /exec: ?ask=thinking shows a pending ask, ?ask=night
     the same ask outside Otto's hours, ?ask=failed a failed one. */
  var ASK_POLL_MS = 10000, ASK_POLL_MAX_MS = 5 * 60000, ASK_MAX = 1000;
  state.ask = { rows: [], draft: "", sending: false, err: null, pollStart: 0, timer: null, stopped: false, demoHour: null };
  function askInHours(at) {
    if (state.ask.demoHour != null) return state.ask.demoHour >= 6 && state.ask.demoHour < 23;
    var m = centralMinutes(at ? new Date(at) : new Date());
    return m >= 6 * 60 && m < 23 * 60;
  }
  function askLatest() { var r = state.ask.rows; return r.length ? r[r.length - 1] : null; }
  function askPending() { var x = askLatest(); return !!x && x.status === "pending"; }
  function askRender() { if (!state.signin && state.snap) render(); }
  function askFocus() {
    var el = document.activeElement;
    if (!el || el.id !== "ask-text") return null;
    return { start: el.selectionStart, end: el.selectionEnd };
  }
  function askRefocus(k) {
    if (!k) return;
    var el = document.getElementById("ask-text");
    if (!el) return;
    try { el.focus({ preventScroll: true }); el.setSelectionRange(k.start, k.end); } catch (e) { /* none */ }
  }
  function askRows(j) {
    return ((j && j.rows) || []).filter(function (r) { return r && typeof r.id === "string"; }).slice(-10);
  }
  function askLoad() {
    if (DEMO) return Promise.resolve();
    var c = creds();
    if (!c) return Promise.resolve();
    return fetch(c.exec + (c.exec.indexOf("?") >= 0 ? "&" : "?") + "k=" + encodeURIComponent(c.key) + "&kind=asks",
      { method: "GET", redirect: "follow", cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (isBadKey(j)) { forget("Key not accepted"); return; }
        if (j && j.ok) { state.ask.rows = askRows(j); state.ask.err = null; }
      })
      .catch(function () { /* offline: keep the last thread */ })
      .then(function () { askSchedule(); askRender(); });
  }
  function askSchedule() {
    clearTimeout(state.ask.timer); state.ask.timer = null;
    if (!askPending() || !askInHours()) { state.ask.pollStart = 0; state.ask.stopped = false; return; }
    if (!state.ask.pollStart) state.ask.pollStart = Date.now();
    if (Date.now() - state.ask.pollStart >= ASK_POLL_MAX_MS) { state.ask.stopped = true; return; }
    state.ask.stopped = false;
    state.ask.timer = setTimeout(function () { if (!DEMO) askLoad(); }, ASK_POLL_MS);
  }
  function askCheck() { state.ask.pollStart = 0; state.ask.stopped = false; askLoad(); }
  function askSend(text) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (!text || state.ask.sending || askPending()) return;
    if (text.length > ASK_MAX) { state.ask.err = "Too long: " + ASK_MAX + " characters at most"; askRender(); return; }
    state.ask.err = null;
    if (DEMO) {
      state.ask.rows = state.ask.rows.concat([{ id: "a-demo-" + Date.now(), ts: new Date().toISOString(), text: text, status: "pending", answer: "", attempts: 0 }]).slice(-10);
      state.ask.draft = ""; askRender();
      setTimeout(function () {
        var x = askLatest();
        if (x && x.status === "pending") { x.status = "answered"; x.answer = "Demo: Otto answers here"; x.answered_at = new Date().toISOString(); askRender(); }
      }, 4000);
      return;
    }
    var c = creds();
    if (!c) { showSignIn(); return; }
    state.ask.sending = true; askRender();
    fetch(c.exec, {
      method: "POST",
      body: JSON.stringify({ k: c.key, kind: "ask", text: text }),
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      redirect: "follow", credentials: "omit"
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (isBadKey(j)) { forget("Key not accepted"); return; }
        if (j && j.ok) {
          state.ask.rows = state.ask.rows.concat([{ id: j.id, ts: j.ts, text: text, status: "pending", answer: "", attempts: 0 }]).slice(-10);
          state.ask.draft = ""; state.ask.pollStart = Date.now();
        } else {
          state.ask.err = j && j.error === "backlog" ? "Otto has 5 questions waiting" : j && j.error === "busy" ? "Too many sends, wait a minute" : "Not sent";
        }
      })
      .catch(function () { state.ask.err = "Offline, not sent"; })
      .then(function () { state.ask.sending = false; askSchedule(); askRender(); });
  }
  function askDemo(s) {
    var rows = (s && s.demo_asks) || [], mode = params.get("ask");
    var now = Date.now(), n = rows.length;
    state.ask.rows = rows.map(function (r, i) {
      var at = new Date(now - (n - i) * 25 * 60000).toISOString();
      return { id: r.id, ts: at, text: r.text, status: r.status || "answered", answer: r.answer || "", answered_at: at, attempts: 0 };
    });
    if (mode === "thinking" || mode === "night" || mode === "failed") {
      state.ask.rows.push({ id: "a-demo-last", ts: new Date(now - 40000).toISOString(),
        text: "Put golf with Jimmy on the calendar Saturday 8am",
        status: mode === "failed" ? "failed" : "pending",
        answer: mode === "failed" ? "Otto could not answer that - try again" : "", attempts: mode === "failed" ? 2 : 0 });
    }
    if (mode === "night") state.ask.demoHour = 23;
    state.ask.rows = state.ask.rows.slice(-10);
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
    // A task row's Done tap stays "Done, syncing" while the snapshot still lists the task;
    // a refused or failed outcome (or no result after a pass) brings the button back.
    ((s.due && s.due.items) || []).forEach(function (t) { if (t.done_id) { live[t.done_id] = 1; pending[t.done_id] = 1; } });
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
  function post(id, rec) {
    if (DEMO) { rec.ok = true; render(); return; }
    var c = creds();
    if (!c) { showSignIn(); return; }
    fetch(c.exec, {
      method: "POST",
      body: JSON.stringify({ k: c.key, action: rec.action, id: id, token: rec.token }),
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
  // A tap shows its result at once, waits UNDO_MS behind the toast, then posts.
  // Undo inside the window cancels locally; nothing was sent.
  var UNDO_MS = 6000, toastTimer = null, toastBatch = null;
  function flushToast() {
    if (!toastBatch) return;
    clearTimeout(toastTimer);
    var b = toastBatch; toastBatch = null; hideToast();
    b.forEach(function (x) { if (state.sent[x.id] === x.rec) post(x.id, x.rec); });
  }
  function tap(list, label) {
    flushToast();
    var batch = list.map(function (x) {
      if (VERBS.indexOf(x.action) < 0) return null;
      delete state.reasons[x.id];
      var rec = { action: x.action, at: new Date().toISOString(), ok: null, token: x.token, held: true };
      state.sent[x.id] = rec;
      return { id: x.id, rec: rec };
    }).filter(Boolean);
    if (!batch.length) return;
    toastBatch = batch;
    render();
    showToast(label, function () {
      clearTimeout(toastTimer);
      batch.forEach(function (x) { if (state.sent[x.id] === x.rec) delete state.sent[x.id]; });
      toastBatch = null; hideToast(); render();
    });
    toastTimer = setTimeout(function () {
      batch.forEach(function (x) { x.rec.held = false; });
      flushToast();
    }, UNDO_MS);
  }
  function send(id, action, token) {
    tap([{ id: id, action: action, token: token }], DONE_WORD[action] || "Sent");
  }
  var $toast = null;
  function showToast(text, onUndo) {
    if (!$toast) { $toast = h("div.toast", { role: "status" }); document.body.appendChild($toast); }
    var t = activeTheme();
    mount($toast, t.renderToast ? t.renderToast({ text: text, onUndo: onUndo }, api) : classic.renderToast({ text: text, onUndo: onUndo }, api));
    $toast.hidden = false;
  }
  function hideToast() { if ($toast) $toast.hidden = true; }

  /* ---------- tab choice ---------- */
  function pendingItems() {
    return ((state.snap && state.snap.needs_you) || []);
  }
  function unsentCount() {
    return pendingItems().filter(function (i) { var r = state.sent[i.id]; return !r || r.ok === false; }).length;
  }
  function pickTab() {
    var x = location.hash.replace("#", "");
    x = OLD_TAB[x] || x;
    // Any word-shaped hash is kept: the look may still be loading, and render() maps an
    // id the look does not have (its alias, else its first tab).
    if (!state.tab) state.tab = /^[a-z]+$/.test(x) ? x : "today";
  }
  // A theme may bring its own tab set ({ id, short, title, fn }); the default is TABS.
  function tabs() { var t = activeTheme(); return (t && t.tabs) || TABS; }
  function go(id) {
    state.tab = id;
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
    if (!state.snap || theme.pending) {
      mount($view, h("div.empty", null, state.loading || theme.pending ? "Loading" : (state.error || (state.offline ? "Offline, no saved snapshot" : "No snapshot yet"))));
      return;
    }
    var t = activeTheme();
    var own = (t.tabs || []).filter(function (x) { return x.id === state.tab; })[0];
    // A theme's alias maps an old tab id (a saved hash) onto one of its own tabs.
    if (t.tabs && !own && t.alias && t.alias[state.tab]) {
      state.tab = t.alias[state.tab];
      own = t.tabs.filter(function (x) { return x.id === state.tab; })[0];
    }
    if (t.tabs && !own) { state.tab = t.tabs[0].id; own = t.tabs[0]; }
    var fn = own ? own.fn : ({ today: "renderToday", lists: "renderLists", activity: "renderActivity", system: "renderSystem" }[state.tab] || "renderToday");
    var keep = askFocus();
    mount($view, (t[fn] || classic[fn] || classic.renderToday)(state.snap, api));
    askRefocus(keep);
  }

  function freshness() {
    var g = state.snap && state.snap.generated;
    if (!g) return { text: "No snapshot yet", stale: false };
    var stale = snapLate(state.snap, Date.now(), STALE_MIN);
    return { text: (stale ? "Stale - updated " : "Updated ") + ago(g), stale: stale };
  }
  function renderTop() {
    var t = activeTheme();
    if (t.renderTop) { mount($top, t.renderTop(state.snap, api)); return; }
    var f = freshness();
    var redesigned = true;
    var sub = DEMO ? "Demo" : state.loading ? "Refreshing" : state.offline ? "Offline - last snapshot" : state.error ? "Error: " + state.error : null;
    var tab = tabs().filter(function (t) { return t.id === state.tab; })[0];
    mount($top,
      redesigned
        ? h("div.fresh", null, h("div.top-title", null, tab ? tab.title : ""), sub ? h("div.meta", null, sub) : null)
        : h("div.fresh", null,
          h("div.fresh-line" + (f.stale ? ".stale" : ""), null, f.text),
          sub ? h("div.sub", null, sub) : null),
      h("button.btn.small.quiet", { type: "button", on: { click: function () { load(); } } }, "Refresh"));
  }
  function renderTabs() {
    var t = activeTheme();
    if (t.renderTabs) { mount($tabs, t.renderTabs(state.snap, api)); return; }
    var n = unsentCount();
    mount($tabs, tabs().map(function (t) {
      return h("button.tab" + (state.tab === t.id ? ".on" : ""), {
        type: "button", "aria-current": state.tab === t.id ? "page" : null,
        on: { click: function () { go(t.id); } }
      }, t.short, t.id === "today" && n ? h("span.badge", null, " " + n) : null);
    }));
  }

  /* ---------- shared: words, health, previews ---------- */
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function agoWords(v) {
    var x = d(v); if (!x) return null;
    var m = Math.max(0, Math.round((Date.now() - x.getTime()) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return plural(m, "minute") + " ago";
    var hr = Math.floor(m / 60), rem = m % 60;
    if (hr < 24) return plural(hr, "hour") + (rem ? " " + plural(rem, "minute") : "") + " ago";
    return plural(Math.floor(hr / 24), "day") + " ago";
  }
  function shortDay(v) { // Sun Oct 18
    var x = d(v); if (!x) return "";
    var o = { timeZone: TZ };
    return x.toLocaleDateString("en-US", Object.assign({ weekday: "short" }, o)) + " " +
      x.toLocaleDateString("en-US", Object.assign({ month: "short" }, o)) + " " +
      x.toLocaleDateString("en-US", Object.assign({ day: "numeric" }, o));
  }
  function eventLine(e) {
    return [e.title, e.start ? shortDay(e.start) : null, e.start ? fmtTime(e.start) : null, e.location]
      .filter(Boolean).join(", ");
  }
  // Exactly what will happen, in one line.
  function preview(it) {
    var e = it.effect || {};
    if (e.preview) return e.preview;
    if (e.op === "event.copy" || e.op === "event.create") return eventLine(e);
    if (e.op === "rsvp") return eventLine(e);
    if (e.op === "gmail.send") {
      var first = String(e.wording || "").split(/\n/)[0];
      return (e.recipients && e.recipients.length ? "To " + [].concat(e.recipients).join(", ") + ": " : "") + first;
    }
    if (e.op === "task.create") return [e.title, e.due ? "due " + shortDay(e.due + "T12:00:00Z") : null, e.list].filter(Boolean).join(", ");
    return e.summary || OPS[e.op] || "";
  }
  function whyText(w) { return !w ? "" : typeof w === "string" ? w : (w.text || ""); }

  // Problems to know about, newest first. Each: short (fits the health line) + detail.
  function health(s) {
    var out = [], today = dayKey(new Date());
    if (!DEMO && state.offline) out.push({ short: "Offline", detail: "Showing the last saved snapshot" });
    if (s.generated && snapLate(s, Date.now(), STALE_MIN)) {
      out.push({ short: "No update for " + agoWords(s.generated).replace(" ago", ""), detail: "Last report " + fmtTime(s.generated) });
    }
    (s.timeline || []).forEach(function (e) {
      if (dayKey(e.ts) !== today || (e.result !== "failed" && e.result !== "error")) return;
      var parts = String(e.summary || OPS[e.action] || e.action || "Action failed").split(": ");
      out.push({ short: parts[0] + " at " + fmtTime(e.ts), detail: parts.slice(1).join(": ") });
    });
    ((s.working || {}).paused_generators || []).forEach(function (g) {
      out.push({ short: (g.label || cap(g.name)) + " suggestions paused", detail: g.reason || "Paused after 3 denials in a row" });
    });
    return out;
  }
  function healthLine(p, countOnly) {
    if (!p.length) return h("div.health", null, h("span.shape.ok", { "aria-hidden": "true" }), h("span", null, "All systems normal"));
    var text = countOnly ? plural(p.length, "problem") : p.length === 1 ? "1 problem: " + p[0].short : p.length + " problems: " + p[0].short + ", and more";
    return h("div.health.warn", null, h("span.shape.warn", { "aria-hidden": "true" }), h("span", null, text));
  }

  /* ---------- Needs You ---------- */
  var ui = { details: {}, addedAll: false, workingDetails: false };
  function isOpen(it) { var r = state.sent[it.id]; return !r || r.ok === false; }
  var GROUP_LABEL = { rsvp: "RSVPs", reply: "Replies", followup: "Tasks", task: "Tasks" };
  function groupOf(it) {
    if (it.decide_today) return { key: "today", label: "Due today", rank: 0 };
    var e = it.effect || {};
    if (it.type === "share") return { key: "share:" + (e.calendar || ""), label: "Share to " + (e.calendar ? e.calendar + " Calendar" : "a calendar"), rank: 1 };
    return { key: it.type || "other", label: GROUP_LABEL[it.type] || cap(it.type || "Other"), rank: 2 };
  }
  function groups(items) {
    var map = {}, list = [];
    items.forEach(function (it) {
      var g = groupOf(it);
      if (!map[g.key]) { map[g.key] = { key: g.key, label: g.label, rank: g.rank, items: [] }; list.push(map[g.key]); }
      map[g.key].items.push(it);
    });
    list.forEach(function (g) { g.items.sort(function (a, b) { return (a.priority || 9) - (b.priority || 9) || ((d(a.expires) || 0) - (d(b.expires) || 0)); }); });
    return list.sort(function (a, b) { return a.rank - b.rank || (a.items[0].priority || 9) - (b.items[0].priority || 9); });
  }
  function tokenFor(it, a) { return (it.tokens && it.tokens[a]) || it.token || ""; }

  function detailsPanel(it) {
    var w = typeof it.why === "object" && it.why ? it.why : {};
    var e = it.effect || {};
    return h("div.details", null, kv([
      ["Type", cap(it.type)],
      ["Does", OPS[e.op] || e.op],
      ["Calendar", e.calendar],
      ["Copies", e.fields],
      ["To", e.recipients],
      ["Subject", e.subject],
      ["Wording", e.wording, "quote"],
      ["Rule", w.rule],
      ["Watcher", w.watcher],
      ["Goal", w.goal],
      ["Lead", it.lead ? nameOf(it.lead) : null],
      ["Agent", it.agent ? nameOf(it.agent) : null],
      ["Priority", it.priority != null ? String(it.priority) : null],
      ["Expires", it.expires ? fmtWhen(it.expires) : null]
    ]));
  }
  function needsCard(it) {
    var r = state.sent[it.id];
    if (r && r.ok !== false) {
      return h("div.card.done", { "data-id": it.id },
        h("span.shape.done", { "aria-hidden": "true" }),
        h("span", null, (DONE_WORD[r.action] || "Sent") + " - " + applyPhrase(r.at)));
    }
    var open = !!ui.details[it.id];
    var acts = (it.actions && it.actions.length ? it.actions : ["approve", "deny", "snooze"])
      .filter(function (a) { return VERBS.indexOf(a) >= 0 && a !== "undo"; });
    return h("div.card.decide", { "data-id": it.id },
      h("div.q", null, it.title),
      h("div.preview", null, preview(it)),
      whyText(it.why) ? h("div.why", null, whyText(it.why)) : null,
      r && r.ok === false ? h("div.status-line", null, "Not sent - " + r.err)
        : state.reasons[it.id] ? h("div.status-line", null, state.reasons[it.id]) : null,
      h("div.actions", null, acts.map(function (a) {
        return h("button.btn" + (a === "approve" ? ".primary" : a === "snooze" ? ".later" : ""), {
          type: "button", on: { click: function () { send(it.id, a, tokenFor(it, a)); } }
        }, VERB_LABEL[a]);
      })),
      h("button.linkish", { type: "button", "aria-expanded": open ? "true" : "false",
        on: { click: function () { ui.details[it.id] = !open; render(); } } }, open ? "Hide details" : "Details"),
      open ? detailsPanel(it) : null);
  }
  function groupBlock(g) {
    var openItems = g.items.filter(function (it) { return isOpen(it) && (!it.actions || it.actions.indexOf("approve") >= 0); });
    var head = h("div.group-head", null, h("div.section-label", null, g.label),
      g.key !== "today" && openItems.length > 1
        ? h("button.btn.small.batch", { type: "button", on: { click: function () {
          tap(openItems.map(function (it) { return { id: it.id, action: "approve", token: tokenFor(it, "approve") }; }),
            "Approved " + openItems.length);
        } } }, "Approve all " + openItems.length)
        : null);
    return h("section.group", null, head, g.items.map(needsCard));
  }
  function addedRow(it) {
    var r = state.sent[it.id];
    if (r && r.ok !== false) {
      return h("li.done", null, h("span.grow.ell", null, (DONE_WORD[r.action] || "Sent") + " - " + applyPhrase(r.at)));
    }
    var expired = it.undo_until && minutesOld(it.undo_until) > 0;
    return h("li", null,
      h("span.grow.ell", null, it.title),
      r && r.ok === false ? h("span.right", null, "Not sent") : null,
      it.undo_token && !expired ? h("button.btn.small.quiet", { type: "button",
        on: { click: function () { send(it.id, "undo", it.undo_token); } } }, "Undo") : null);
  }
  function viewNeeds(s) {
    var items = pendingItems();
    var open = items.filter(isOpen);
    var due = open.filter(function (it) { return it.decide_today; }).length;
    var mins = Math.ceil(open.length * 20 / 60);
    var added = (s.added_today || []).slice().sort(function (a, b) { return (d(b.at) || 0) - (d(a.at) || 0); });
    var shown = ui.addedAll ? added : added.slice(0, 3);
    return [
      h("div.panel.today", null,
        h("div.big", null, open.length ? plural(open.length, "decision") : "Nothing to decide"),
        open.length ? h("div", null, "About " + plural(mins, "minute")) : null,
        open.length ? h("div", null, due ? due + " due today" : "None due today") : null,
        healthLine(health(s))),
      items.length ? groups(items).map(groupBlock) : null,
      h("section.group", null,
        h("div.group-head", null, h("div.section-label", null, "Added today")),
        added.length
          ? h("div.panel", null, h("ul.compact", null, shown.map(addedRow)),
            added.length > 3 ? h("button.linkish", { type: "button", on: { click: function () { ui.addedAll = !ui.addedAll; render(); } } },
              ui.addedAll ? "Show fewer" : "Show " + (added.length - 3) + " more") : null)
          : h("div.panel.empty-line", null, "Nothing added yet"))
    ];
  }

  /* ---------- Working ---------- */
  function todayCounts(s) {
    var t = (s.working || {}).today;
    if (!t) {
      var today = dayKey(new Date());
      t = { tasks: 0, events: 0, pushes: 0, approvals: 0 };
      (s.timeline || []).forEach(function (e) {
        if (dayKey(e.ts) !== today || e.result !== "ok") return;
        if (e.action === "task.create") t.tasks++;
        else if (e.action === "event.copy" || e.action === "event.create") t.events++;
        else if (e.action === "notify.push") t.pushes++;
        else if (e.action === "approve") t.approvals++;
      });
    }
    return [
      t.tasks ? "Filed " + plural(t.tasks, "task") : null,
      t.events ? "Filed " + plural(t.events, "event") : null,
      t.pushes ? "Sent " + plural(t.pushes, "push", "pushes") : null,
      t.approvals ? plural(t.approvals, "approval") : null
    ].filter(Boolean);
  }
  function inventory(s) {
    var t = s.tick || {}, w = s.working || {}, ti = tickInfo();
    var states = w.agent_states || [], gates = s.gates || [], ks = s.kill_switch;
    return h("div.details.inventory", null,
      kv([
        ["Last tick", t.last ? fmtTime(t.last) : null],
        ["Cadence", ti.cadence + " min"],
        ["Ticks run", clock(ti.firstMorning) + " to " + clock(ti.lastEvening)],
        ["Time to clear", w.time_to_clear_7d_min != null ? w.time_to_clear_7d_min + " min, 7-day average" : null],
        ["Flex days", w.flex_used_7d != null ? w.flex_used_7d + " of " + (w.flex_max_7d || 2) + " this week" : null],
        ["Memory", ks ? (ks.on ? "On" : "Off") : null]
      ]),
      h("div.sub-label", null, "Ran today"),
      h("ul.list", null, (t.ran_today || []).map(function (a) {
        var id = typeof a === "string" ? a : a.agent;
        return h("li", null, h("span.grow", null, nameOf(id)), a.runs != null ? h("span.right", null, plural(a.runs, "run")) : null);
      })),
      h("div.sub-label", null, "Agents"),
      h("ul.list", null, states.map(function (x) {
        return h("li", null, h("span.grow", null, x.name || nameOf(x.id)), st(x.state));
      })),
      h("div.sub-label", null, "Gates"),
      h("ul.list", null, gates.map(function (g) {
        return h("li", null, h("span.grow", null, g.name), st(g.state));
      })));
  }
  function viewWorking(s) {
    var p = health(s), counts = todayCounts(s), w = s.working || {}, ti = tickInfo();
    var next = null, last = d((s.tick || {}).last);
    if (last) { next = new Date(last.getTime()); while (next <= new Date()) next = new Date(next.getTime() + ti.cadence * 60000); }
    return [
      h("div.panel.today", null,
        healthLine(p, true),
        p.length ? h("ul.problems", null, p.map(function (x) {
          return h("li", null, h("div", null, x.short), x.detail ? h("div.meta", null, x.detail) : null);
        })) : null),
      h("section.group", null,
        h("div.group-head", null, h("div.section-label", null, "Today")),
        h("div.panel", null, counts.length ? counts.map(function (c) { return h("div.line", null, c); }) : h("div.line", null, "Nothing filed yet"),
          (w.workers || []).map(function (x) { return h("div.line", null, st("running", "Now: " + (x.task || nameOf(x.id)))); }))),
      h("section.group", null,
        h("div.group-head", null, h("div.section-label", null, "Last update")),
        h("div.panel", null,
          h("div.line", null, cap(agoWords(s.generated) || "No update yet")),
          next ? h("div.line.meta", null, "Next check about " + fmtTime(next)) : null)),
      h("section.group", null,
        h("button.linkish.disclose", { type: "button", "aria-expanded": ui.workingDetails ? "true" : "false",
          on: { click: function () { ui.workingDetails = !ui.workingDetails; render(); } } },
          ui.workingDetails ? "Hide details" : "Details"),
        ui.workingDetails ? inventory(s) : null)
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

  /* Lists: Google Tasks, one section per list in routing order */
  var LIST_SHOW = 5;
  function taskLists(s) {
    var t = s.tasks || {};
    // pending: the snapshot predates the tasks block (an old snapshot), not "not connected".
    return { connected: t.connected === true, pending: !s.tasks, lists: (t.lists || []).filter(function (l) { return l && l.name; }) };
  }
  function listToggle(key) { ui.listOpen = ui.listOpen || {}; ui.listOpen[key] = !ui.listOpen[key]; render(); }
  function listShown(l) { var all = l.items || []; return (ui.listOpen || {})[l.key] ? all : all.slice(0, LIST_SHOW); }
  function viewLists(s) {
    var tl = taskLists(s), out = [h("h1", null, "Lists")];
    if (!tl.connected) { out.push(h("div.empty", null, tl.pending ? "Lists load on the next update" : "Tasks not connected")); return out; }
    tl.lists.forEach(function (l) {
      var items = l.items || [], n = +l.count || 0, c = +l.clinical || 0;
      if (!n && !c) { out.push(h("div.card", null, h("h2", null, l.name + " - " + (l.error ? "not read" : "empty")))); return; }
      out.push(h("div.card", null, h("h2", null, l.name + " - " + n + " open"),
        h("ul.list", null, listShown(l).map(function (x) {
          return h("li", null, h("span.grow", null, x.title + (x.due_text ? ", due " + x.due_text : "")),
            x.otto ? h("span.right", null, "Otto") : null,
            x.undo_item && x.undo_token ? h("button.btn.small.quiet", { type: "button", on: { click: function () { send(x.undo_item, "undo", x.undo_token); } } }, "Undo") : null);
        })),
        items.length > LIST_SHOW ? h("button.btn.small.quiet", { type: "button", on: { click: function () { listToggle(l.key); } } },
          (ui.listOpen || {})[l.key] ? "Show fewer" : "Show " + (items.length - LIST_SHOW) + " more") : null,
        c ? h("div.meta", null, plural(c, "clinical task")) : null));
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

  /* ---------- shared data helpers for themes ---------- */
  var TYPE_LABEL = { rsvp: "RSVP", share: "Calendar share", reply: "Reply", followup: "Task", task: "Task", task_create: "Task" };
  function typeLabel(it) { return TYPE_LABEL[it.type] || cap(String(it.type || "Item").replace(/_/g, " ")); }
  function areaOf(it) { return it.area || ""; }
  // Which preview a decision gets: a mini calendar card, the full reply text, or one line.
  function previewKind(it) {
    var op = (it.effect || {}).op;
    if (op === "event.copy" || op === "event.create" || op === "rsvp") return "event";
    if (op === "gmail.send") return "reply";
    return "line";
  }
  // Calendar preview: day, date, title, time, place. The event start wins (the demo moves
  // to today); the effect's own day/date/time/place fields are the fallback.
  function calPreview(it) {
    var e = it.effect || {}, x = d(e.start), o = { timeZone: TZ };
    var time = x ? fmtTime(x) + (d(e.end) ? " to " + fmtTime(e.end) : "") : (e.time || "");
    return {
      day: x ? x.toLocaleDateString("en-US", Object.assign({ weekday: "short" }, o)) : (e.day || ""),
      month: x ? x.toLocaleDateString("en-US", Object.assign({ month: "short" }, o)) : String(e.date || "").split(" ")[0],
      num: x ? x.toLocaleDateString("en-US", Object.assign({ day: "numeric" }, o)) : String(e.date || "").split(" ").pop(),
      date: x ? shortDay(x).replace(/^\w+ /, "") : (e.date || ""),
      title: e.title || it.title || "",
      time: time,
      place: e.location || e.place || "",
      calendar: e.calendar || "",
      response: e.response || ""
    };
  }
  function replyPreview(it) {
    var e = it.effect || {};
    return { to: [].concat(e.recipients || []).join(", "), subject: e.subject || "", text: String(e.wording || "") };
  }
  function openItems() { return pendingItems().filter(isOpen); }
  function minutesToClear(n) { return n ? Math.ceil(n * 20 / 60) : 0; }
  // "Done today" = the Activity tab's Done rows under today's date: the same timeline, the
  // same test (result ok), the same Chicago day. The snapshot's working.today.done agrees.
  function doneToday(s) {
    var today = dayKey(new Date()), n = 0;
    (s.timeline || []).forEach(function (e) { if (e && e.result === "ok" && dayKey(e.ts) === today) n++; });
    return n;
  }
  function handled(s) { return (s.added_today || []).slice().sort(function (a, b) { return (d(b.at) || 0) - (d(a.at) || 0); }); }
  function undoable(it) { return !!(it.undo_token && !(it.undo_until && minutesOld(it.undo_until) > 0)); }
  function nextCheck(s) {
    var ti = tickInfo(), last = d((s.tick || {}).last), next = null;
    if (last) { next = new Date(last.getTime()); while (next <= new Date()) next = new Date(next.getTime() + ti.cadence * 60000); }
    return next;
  }
  // Demo-only series and team fields (absent in live snapshots: themes must handle null).
  function series(s) {
    var w = s.working || {};
    return {
      timeToClear: w.time_to_clear_series_7d || null,
      teamsNow: w.teams_now || (w.workers || []).map(function (x) { return { id: x.id, name: nameOf(x.id), task: x.task }; }),
      teamToday: w.team_today || null,
      sleep: s.sleep || null
    };
  }
  // Last 7 day labels ending today, oldest first: ["Sun", ..., "Sat"].
  function lastDays(n) {
    var out = [], now = Date.now();
    for (var i = n - 1; i >= 0; i--) out.push(new Date(now - i * 86400000).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" }));
    return out;
  }
  function stateIds(s) {
    var org = s.org || {}, used = [];
    (org.departments || []).forEach(function (dp) { used.push(dp.lead_state); (dp.members || []).forEach(function (m) { used.push(m.state); }); });
    (org.domains || []).forEach(function (dm) { used.push(dm.owner_state); });
    (s.gates || []).forEach(function (g) { used.push(g.state); });
    return used;
  }

  /* ---------- themes ----------
     A theme is { label, standalone?, renderToday, renderLists, renderActivity, renderSystem,
     renderToast, renderTop?, renderTabs? }. Each render function gets (snapshot, api) and
     returns a node, a list of nodes or text. It never fetches or writes; taps go through
     api.send / api.tap. CSS: themes/<name>.css. Template: themes/<name>.js calling
     OttoHome.register("<name>", theme). List: themes/list.js. */
  var registry = {};
  var THEME_LIST = (window.OTTO_THEMES || []).filter(function (x) { return x && /^[a-z0-9-]+$/.test(x.id); });
  var theme = { name: "classic", pending: false };
  function activeTheme() { return (!theme.pending && registry[theme.name]) || classic; }
  function knownTheme(n) { return n === "classic" || THEME_LIST.some(function (x) { return x.id === n; }); }
  // Production always runs the default look (the first in themes/list.js); only ?demo=1
  // may pick another, by ?theme= or the Look picker.
  function wantedTheme() {
    var def = (THEME_LIST[0] && THEME_LIST[0].id) || "classic";
    if (!DEMO) return def;
    var n = params.get("theme") || store.get(THEME_KEY) || def;
    return knownTheme(n) ? n : "classic";
  }
  function needsOf(n) {
    var e = THEME_LIST.filter(function (x) { return x.id === n; })[0];
    return ((e && e.needs) || []).filter(function (x) { return /^[a-z0-9-]+$/.test(x); });
  }
  function baseCss(on) { var l = document.getElementById("base-css"); if (l) l.disabled = !on; }
  function applyTheme() {
    var t = activeTheme();
    document.documentElement.setAttribute("data-theme", registry[theme.name] && !theme.pending ? theme.name : "classic");
    baseCss(!(t.standalone && !state.signin));
    if (t.themeColor) { var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", t.themeColor); }
  }
  function loadTheme(n) {
    theme.name = n;
    if (n === "classic" || registry[n]) { theme.pending = false; applyTheme(); return; }
    theme.pending = true;
    var done = false;
    function finish() {
      if (done) return; done = true;
      theme.pending = false;
      if (!registry[n]) theme.name = "classic";
      applyTheme(); if (!state.signin) render();
    }
    // Helper modules ("needs") first, then the theme: css in order, scripts one by one.
    var files = needsOf(n).concat([n]);
    files.forEach(function (f) {
      var css = document.createElement("link");
      css.rel = "stylesheet"; css.href = "themes/" + f + ".css";
      document.head.appendChild(css);
    });
    (function next(i) {
      var js = document.createElement("script");
      js.src = "themes/" + files[i] + ".js";
      js.onload = js.onerror = function () { if (i + 1 < files.length) next(i + 1); else finish(); };
      document.head.appendChild(js);
    })(0);
    setTimeout(finish, 4000);
  }
  function setTheme(n) {
    if (!knownTheme(n)) return;
    if (DEMO) store.set(THEME_KEY, n);
    var q = new URLSearchParams(location.search); q.set("theme", n);
    location.search = q.toString();
  }
  function themeChoices() {
    return [{ id: "classic", label: "Classic", note: "The original light look" }].concat(THEME_LIST.map(function (x) {
      return { id: x.id, label: x.label || cap(x.id), note: x.note || "" };
    }));
  }
  // Generic Look picker; themes may style .look or build their own from api.themeChoices().
  function lookPicker() {
    if (!DEMO) return null;
    return h("section.look", { "aria-label": "Look" },
      h("div.look-head", null, "Look"),
      h("div.look-list", null, themeChoices().map(function (x) {
        var on = x.id === theme.name;
        return h("button.look-item" + (on ? ".on" : ""), { type: "button", "aria-pressed": on ? "true" : "false",
          on: { click: function () { setTheme(x.id); } } },
          h("span.look-name", null, (on ? "Current: " : "") + x.label),
          x.note ? h("span.look-note", null, x.note) : null);
      })));
  }

  /* The built-in theme: the original light look, now on four tabs. Also the fallback
     whenever a theme file is missing or fails to load. */
  var classic = {
    label: "Classic",
    renderToday: function (s) { return viewNeeds(s); },
    renderLists: function (s) { return viewLists(s); },
    renderActivity: function (s) { return viewTimeline(s); },
    renderSystem: function (s) { return [viewWorking(s), h("div.group"), viewBuilt(s), lookPicker()]; },
    renderToast: function (t) {
      return [h("span.toast-text", null, t.text),
        h("button.toast-undo", { type: "button", on: { click: t.onUndo } }, "Undo")];
    }
  };

  // Everything a theme may use. Read-only views over state plus the two write paths.
  var api = {
    DEMO: DEMO, TZ: TZ, TABS: TABS, VERB_LABEL: VERB_LABEL, DONE_WORD: DONE_WORD, OPS: OPS, STATES: STATES,
    h: h, add: add, mount: mount,
    d: d, fmtTime: fmtTime, fmtDay: fmtDay, fmtDayOnly: fmtDayOnly, fmtWhen: fmtWhen, shortDay: shortDay,
    dayKey: dayKey, ago: ago, agoWords: agoWords, minutesOld: minutesOld, cap: cap, plural: plural,
    nameOf: nameOf, clock: clock, tickInfo: tickInfo, nextCheck: nextCheck, freshness: freshness,
    st: st, legend: legend, kv: kv,
    health: health, healthLine: healthLine, nextFire: nextFire, snapLate: snapLate, nextSnapshot: nextSnapshot, todayCounts: todayCounts,
    preview: preview, previewKind: previewKind, calPreview: calPreview, replyPreview: replyPreview,
    whyText: whyText, typeLabel: typeLabel, areaOf: areaOf, groups: groups, groupOf: groupOf,
    pendingItems: pendingItems, openItems: openItems, isOpen: isOpen, unsentCount: unsentCount,
    minutesToClear: minutesToClear, doneToday: doneToday, handled: handled, undoable: undoable,
    series: series, lastDays: lastDays, stateIds: stateIds,
    taskLists: taskLists, listShown: listShown, listToggle: listToggle, LIST_SHOW: LIST_SHOW,
    snap: function () { return state.snap; },
    sent: function (id) { return state.sent[id] || null; },
    reason: function (id) { return state.reasons[id] || null; },
    applyPhrase: applyPhrase, tokenFor: tokenFor,
    send: send, tap: tap, refresh: function () { return load(); },
    go: go, tab: function () { return state.tab; }, tabs: function () { return tabs(); }, render: function () { render(); },
    ui: ui, themeName: function () { return theme.name; }, themeChoices: themeChoices, setTheme: setTheme,
    lookPicker: lookPicker,
    ask: {
      rows: function () { return state.ask.rows; },
      pending: askPending, inHours: askInHours, send: askSend, check: askCheck,
      sending: function () { return state.ask.sending; }, error: function () { return state.ask.err; },
      stopped: function () { return state.ask.stopped; },
      draft: function (v) { if (v !== undefined) state.ask.draft = String(v); return state.ask.draft; },
      MAX: ASK_MAX
    }
  };
  window.OttoHome = {
    register: function (name, impl) { if (/^[a-z0-9-]+$/.test(name) && impl) registry[name] = impl; }
  };

  /* ---------- sign-in ---------- */
  function showSignIn(msg) {
    state.signin = true;
    $top.hidden = true; $tabs.hidden = true;
    applyTheme();
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
          state.signin = null; state.snap = valid(j) ? j : null; applyTheme();
          if (state.snap) store.set(K.snap, JSON.stringify(j));
          pickTab(); render();
        })
        .catch(function () { mount(note, "Could not reach the Web App"); });
    } } },
      h("h1", null, "OttoOS"),
      h("label", { "for": "exec" }, "Web App URL"), exec,
      h("label", { "for": "key" }, "Key"), key,
      h("button.btn.primary", { type: "submit" }, "Save"),
      note);
    mount($view, form);
  }

  /* ---------- boot ---------- */
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* none */ }
  if ("serviceWorker" in navigator) {
    try { navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" }).catch(function () {}); } catch (e) { /* none */ }
    // A new service worker took over (a deploy): reload once so the new shell shows now.
    // Only when one was already in control, so the first install never reloads.
    try {
      var hadController = !!navigator.serviceWorker.controller, reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (!hadController || reloaded) return;
        reloaded = true;
        location.reload();
      });
    } catch (e) { /* none */ }
  }
  window.addEventListener("hashchange", function () {
    var x = location.hash.replace("#", ""), t = activeTheme();
    x = (t.alias && t.alias[x]) || OLD_TAB[x] || x;
    if (tabs().some(function (y) { return y.id === x; })) { state.tab = x; render(); }
  });
  loadTheme(wantedTheme());
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && !state.signin && !DEMO) { load(); if (askPending()) askCheck(); }
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
