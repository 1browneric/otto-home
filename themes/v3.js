/* OttoOS v3, the production look. Four text tabs: Today (the day, with decisions on the
   first screen and the system beside it), Inbox (decisions, filed today, unread mail),
   Lists (tasks by date) and Otto (agents, VM, activity, decisions on record).
   Reads the v3 snapshot blocks (today, weather, recovery, sports, truck, due, inbox,
   lookahead, watching, goals, platform, agents_runs, vm, decisions). Any block may be
   missing or { connected: false }: a glance tile is then left out, a card collapses to
   one muted line or is left out. Rendering only: every tap goes through api.send;
   no fetch, no storage, text nodes only. No icons anywhere: tabs are words. */
(function () {
  "use strict";
  if (!window.OttoHome) return;

  var ui = { list: "All", map: false, past: false };

  /* ---------- small helpers ---------- */
  // Status = shape + word, always, with a legend on every tab.
  // Kinds: live (on schedule / done), run (working now), dry (dry run), dark (off), wait (waiting on you, late, overdue).
  var KIND = {
    live: { word: "Live" }, ok: { word: "OK" }, run: { word: "Running" }, dry: { word: "Dry run" },
    dark: { word: "Off" }, wait: { word: "Needs you" }, late: { word: "Late" }
  };
  var STATE_KIND = { live: "live", running: "run", dry_run: "dry", dark: "dark", dormant: "dark", manual: "dark", late: "late", needs_you: "wait" };
  var STATE_WORD = { live: "On schedule", late: "Late", manual: "Manual", dark: "No run yet" };
  var VERB_WORD = { approve: "Approve", deny: "Deny", snooze: "Later" };
  function shape(api, kind) { return api.h("span.v-shape.v-" + kind, { "aria-hidden": "true" }); }
  function status(api, kind, word) {
    return api.h("span.v-status.v-s-" + kind, null, shape(api, kind), api.h("span", null, word || (KIND[kind] || {}).word || ""));
  }
  function legend(api) {
    return api.h("section.v-legend-card", { "aria-label": "Legend" },
      api.h("div.v-legend-head", null, "Legend"),
      api.h("div.v-legend", null,
        status(api, "live", "On schedule or done"),
        status(api, "wait", "Waiting on you, late or overdue"),
        status(api, "run", "Working now"),
        status(api, "dry", "Dry run"),
        status(api, "dark", "Manual, off or no run yet")));
  }
  function card(api, label, right, body, extra) {
    return api.h("section.v-card" + (extra || ""), null,
      label ? api.h("div.v-card-head", null, api.h("h2.v-label", null, label), right || null) : null,
      body);
  }
  function link(api, text, fn) { return api.h("button.v-link", { type: "button", on: { click: fn } }, text); }
  function muted(api, text) { return api.h("div.v-muted-line", null, text); }
  function on(x) { return !!x && x.connected !== false; }
  function todayKey(api) { return api.dayKey(new Date()); }
  function keyPlus(api, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayKey(api));
    if (!m) return "";
    var x = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n, 12));
    return x.toISOString().slice(0, 10);
  }
  function shortDate(api, n) { // "Oct 14"
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(keyPlus(api, n));
    if (!m) return "";
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  }
  function openNeeds(api) {
    return api.openItems().slice().sort(function (a, b) {
      return (b.decide_today ? 1 : 0) - (a.decide_today ? 1 : 0) || (a.priority || 9) - (b.priority || 9);
    });
  }
  function nowMs() { return Date.now(); }
  function ord(n, node) { if (node && node.style) node.style.order = n; return node; }

  /* ---------- schedules: the snapshot carries each agent's cron lines (UTC, as the VM
     runs them); the next run is computed here against this device's clock, so a snapshot
     read later never shows a next run that already went by. ---------- */
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
  function has(set, v) { return set === null || !!set[v]; }
  function firesOn(sp, day) { // day: a Date at 00:00 UTC
    if (!has(sp[3], day.getUTCMonth() + 1)) return false;
    var domOk = has(sp[2], day.getUTCDate()), dowOk = has(sp[4], day.getUTCDay());
    return sp[2] !== null && sp[4] !== null ? domOk || dowOk : domOk && dowOk;
  }
  function list(set, lo, hi) { var o = []; for (var x = lo; x <= hi; x++) if (has(set, x)) o.push(x); return o; }
  function nextFire(lines, fromMs) {
    var specs = cronSpecs(lines), best = null, base = Math.floor(fromMs / 60000) * 60000;
    specs.forEach(function (sp) {
      var hrs = list(sp[1], 0, 23), mins = list(sp[0], 0, 59);
      for (var n = 0; n < 9; n++) {
        var d0 = new Date(Math.floor(base / 86400000) * 86400000 + n * 86400000);
        if (!firesOn(sp, d0)) continue;
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
  function daily(lines) { // "Daily at 6:41 AM" for one fixed time every day, else null
    var sp = cronSpecs(lines);
    if (sp.length !== 1 || sp[0][2] !== null || sp[0][3] !== null || sp[0][4] !== null) return null;
    var h = list(sp[0][1], 0, 23), m = list(sp[0][0], 0, 59);
    return h.length === 1 && m.length === 1 ? { h: h[0], m: m[0] } : null;
  }
  // Always a 12-hour time; a short day word when not today: "2:13 PM", "Sun 6:41 AM",
  // "Oct 5 6:00 AM" beyond a week. Short enough for an agent row at 18px on a phone.
  function whenLabel(api, v) {
    var x = api.d(v);
    if (!x) return "";
    var k = api.dayKey(x), t = api.fmtTime(x);
    if (k === todayKey(api)) return t;
    for (var n = -6; n <= 6; n++) {
      if (k === keyPlus(api, n)) return x.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short" }) + " " + t;
    }
    return x.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }) + " " + t;
  }
  function dayWord(api, v) {
    var x = api.d(v);
    if (!x) return "";
    var k = api.dayKey(x);
    if (k === todayKey(api)) return "today";
    if (k === keyPlus(api, 1)) return "tomorrow";
    return x.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long" });
  }
  function agentNext(x) { return x.cron ? nextFire(x.cron, nowMs()) : (x.next_at ? new Date(x.next_at) : null); }

  /* ---------- the day anchor every non-Today tab leads with ---------- */
  function upcoming(api, s) {
    var ev = ((s.today || {}).events || []).filter(function (e) { var x = api.d(e.start); return !e.all_day && x && x.getTime() > nowMs(); });
    ev.sort(function (a, b) { return api.d(a.start) - api.d(b.start); });
    return ev;
  }
  function stripStat(api, label, n, amber) {
    return api.h("div.v-strip-stat", null,
      api.h("span.v-strip-l", null, amber ? status(api, "wait", label) : label),
      api.h("span.v-strip-n.v-num" + (amber ? ".v-amber" : ""), null, String(n)));
  }
  function dayStrip(api, s) {
    if (!on(s.today) && !on(s.due)) return null;
    var g = dueGroups(api, s), ev = on(s.today) ? upcoming(api, s).slice(0, 2) : [];
    return api.h("section.v-strip", { "aria-label": "Your day" },
      ev.map(function (e, i) {
        return api.h("div.v-strip-row", null,
          api.h("span.v-strip-k", null, i ? "Then" : "Next"),
          api.h("span.v-strip-t.v-num", null, api.fmtTime(e.start)),
          api.h("span.v-strip-x", null, e.title));
      }),
      on(s.due) ? stripStat(api, "Due today", g.today.length) : null,
      on(s.due) && g.overdue.length ? stripStat(api, "Overdue", g.overdue.length, true) : null);
  }

  /* ---------- Today: glance tiles (a tile without a source is left out) ---------- */
  function tile(api, kicker, big, lines, cls) {
    return api.h("div.v-tile" + (cls || ""), null,
      api.h("div.v-tile-k", null, kicker),
      api.h("div.v-tile-big.v-num", null, big),
      lines.filter(Boolean).map(function (l) { return api.h("div.v-tile-l", null, l); }));
  }
  function glance(api, s) {
    var w = s.weather, r = s.recovery, sp = s.sports, t = s.truck, tiles = [];
    if (on(w) && w.hi != null) tiles.push(tile(api, "Weather", w.hi + "° / " + w.lo + "°", [w.sky, w.wind, w.rain]));
    if (on(r) && r.recovery_pct != null) tiles.push(tile(api, "Recovery", r.recovery_pct + "%", [r.hrv != null ? "HRV " + r.hrv : null, r.sleep_text ? "Sleep " + r.sleep_text : null, r.rhr != null ? "RHR " + r.rhr : null]));
    if (on(sp) && sp.game) {
      tiles.push(tile(api, "Game today", sp.game.headline, [api.fmtTime(sp.game.time), sp.game.channel ? "On " + sp.game.channel : null], ".v-tile-text"));
    } else {
      var wk = weekTile(api, s);
      if (wk) tiles.push(wk);
    }
    if (on(t) && t.fuel_pct != null) tiles.push(tile(api, t.name || "Truck", t.fuel_pct + "%", [t.gallons != null ? t.gallons + " gal" : null, t.range_mi != null ? "Range " + t.range_mi + " mi" : null, t.odometer ? "Odometer " + String(t.odometer).replace(" mi", "") : null]));
    return tiles.length ? api.h("div.v-glance", { "aria-label": "At a glance" }, tiles) : null;
  }

  // In the game slot on a day with no game: the week ahead, counted.
  function weekTile(api, s) {
    var l = s.lookahead, u = s.due;
    if (!on(l) && !on(u)) return null;
    var evN = on(l) ? (l.days || []).reduce(function (a, dy) { return a + (dy.items || []).length; }, 0) : null;
    var dl = on(u) ? (u.items || []).filter(function (t) { return t.day_offset != null && t.day_offset >= 1 && t.day_offset <= 7; }).length : null;
    var first = on(l) ? (l.days || [])[0] : null, firstIt = first && (first.items || [])[0];
    return tile(api, "Week ahead", evN != null ? api.plural(evN, "event") : api.plural(dl, "deadline"), [
      evN != null && dl ? api.plural(dl, "deadline") : null,
      firstIt ? "Next: " + firstIt.title : null], ".v-tile-text");
  }

  /* ---------- Today: timeline ---------- */
  function isPast(api, e, now) {
    if (e.all_day) return false;
    var x = api.d(e.start);
    return (e.end ? api.d(e.end).getTime() : x.getTime() + 30 * 60000) < now;
  }
  function evTime(api, e) {
    if (e.all_day) return [api.h("div", null, "All day")];
    return [api.h("div", null, api.fmtTime(e.start)), e.end ? api.h("div.v-ev-end", null, api.fmtTime(e.end)) : null];
  }
  function timeline(api, s) {
    var t = s.today;
    if (!t) return null;
    if (!on(t)) return card(api, "Today", null, muted(api, "Calendar not read this check"));
    var ev = (t.events || []).filter(function (e) { return api.d(e.start); }).slice().sort(function (a, b) {
      return (b.all_day ? 1 : 0) - (a.all_day ? 1 : 0) || api.d(a.start) - api.d(b.start);
    });
    var rows = [], nowPlaced = false, now = nowMs();
    var conflictAt = {};
    (t.conflicts || []).forEach(function (c) { var x = api.d(c.at); if (x) conflictAt[x.getTime()] = c; });
    var pastN = ev.filter(function (e) { return isPast(api, e, now); }).length;
    if (pastN && !ui.past) {
      rows.push(api.h("div.v-earlier", null,
        api.h("span.v-earlier-t", null, "Earlier"),
        api.h("span.v-earlier-n.v-num", null, api.plural(pastN, "event")),
        link(api, "Show", function () { ui.past = true; api.render(); })));
    }
    ev.forEach(function (e) {
      var x = api.d(e.start), past = isPast(api, e, now);
      if (past && !ui.past) return;
      if (!nowPlaced && !e.all_day && x.getTime() > now) {
        rows.push(api.h("div.v-now", { "aria-label": "Now" }, api.h("span.v-now-t.v-num", null, "Now " + api.fmtTime(new Date())), api.h("span.v-now-line")));
        nowPlaced = true;
      }
      rows.push(api.h("div.v-ev" + (past ? ".v-past" : ""), null,
        api.h("div.v-ev-time.v-num", null, evTime(api, e)),
        api.h("div.v-ev-main", null,
          api.h("div.v-ev-title", null, e.title),
          api.h("div.v-ev-sub", null, api.h("span.v-tag", null, e.tag), e.place && !e.clinical ? api.h("span", null, e.place) : null))));
      var c = conflictAt[x.getTime()];
      if (c) rows.push(api.h("div.v-conflict", null, status(api, "wait", "Conflict"), api.h("span.v-conflict-x", null, c.text)));
    });
    if (!ev.length) rows.push(muted(api, "Nothing on the calendar today"));
    else if (!nowPlaced) rows.push(api.h("div.v-now", null, api.h("span.v-now-t.v-num", null, "Now " + api.fmtTime(new Date())), api.h("span.v-now-line")));
    return card(api, "Today", api.h("span.v-card-meta", null, api.plural(ev.length, "event")),
      [api.h("div.v-tl", null, rows), t.footer ? api.h("div.v-foot", null, t.footer) : null]);
  }

  /* ---------- Needs You ---------- */
  function sentLine(api, it) {
    var r = api.sent(it.id);
    if (!r || r.ok === false) return null;
    return api.h("div.v-sent", null, status(api, "live", (api.DONE_WORD[r.action] || "Sent") + (r.held ? ", sending" : "")));
  }
  function verbs(it) {
    var allowed = it.actions || ["approve", "deny", "snooze"];
    return ["approve", "deny", "snooze"].filter(function (v) { return allowed.indexOf(v) >= 0; });
  }
  function buttons(api, it) {
    return api.h("div.v-btns", null, verbs(it).map(function (v, i) {
      return api.h("button.v-btn" + (i === 0 ? ".v-primary" : ""), { type: "button",
        on: { click: function () { api.send(it.id, v, api.tokenFor(it, v)); } } }, VERB_WORD[v]);
    }));
  }
  function needCompact(api, it) {
    var done = sentLine(api, it), reason = api.reason(it.id);
    return api.h("div.v-need", null,
      api.h("div.v-need-title", null, it.title),
      api.h("div.v-need-why", null, api.whyText(it.why)),
      it.decide_today ? api.h("div.v-need-due", null, status(api, "wait", "Decide today")) : null,
      reason ? api.h("div.v-need-why", null, reason) : null,
      done || buttons(api, it));
  }
  function needsCard(api, n) {
    var list = openNeeds(api), shown = list.slice(0, n);
    var right = list.length > shown.length ? link(api, "See all " + list.length, function () { api.go("inbox"); })
      : api.h("span.v-card-meta", null, list.length ? api.plural(list.length, "decision") : "");
    if (!shown.length) return null;  // the top bar already says Clear
    return card(api, "Needs you", right, shown.map(function (it) { return needCompact(api, it); }), ".v-card-needs");
  }

  /* ---------- tasks by date ---------- */
  function dueGroups(api, s) {
    var g = { overdue: [], today: [], week: [], later: [], none: [] }, u = s.due || {};
    (u.items || []).forEach(function (t) {
      var o = t.day_offset;
      if (o == null) g.none.push(t);
      else if (o < 0) g.overdue.push(t);
      else if (o === 0) g.today.push(t);
      else if (o <= 7) g.week.push(t);
      else g.later.push(t);
    });
    Object.keys(g).forEach(function (k) { g[k].sort(function (a, b) { return (a.day_offset || 0) - (b.day_offset || 0); }); });
    return g;
  }
  function taskRow(api, t, bare) {
    var o = t.day_offset, when;
    if (o == null) when = "No date";
    else if (o < 0) when = shortDate(api, o);
    else if (o === 0) when = "Today";
    else if (o === 1) when = "Tomorrow";
    else when = shortDate(api, o);
    return api.h("div.v-task" + (o != null && o < 0 ? ".v-over" : ""), null,
      bare ? null : api.h("div.v-task-when.v-num", null, o != null && o < 0 ? shape(api, "wait") : null, api.h("span", null, when)),
      api.h("div.v-task-main", null,
        api.h("div.v-task-title", null, t.title),
        api.h("div.v-task-sub", null, t.list, t.otto ? api.h("span.v-otto", null, "Otto made") : null)),
      taskDone(api, t));
  }
  // The Done tap on a task row: a text button; 6 s Undo toast, then the post. The row reads
  // "Done, syncing" until a snapshot without the task arrives.
  function taskDone(api, t) {
    if (!t.done_id || !t.done_token) return null;
    var r = api.sent(t.done_id);
    if (r && r.ok !== false) return api.h("div.v-task-done", null, status(api, "live", "Done, syncing"));
    return api.h("div.v-task-done", null,
      api.h("button.v-btn.v-btn-sm", { type: "button", "aria-label": "Done: " + t.title,
        on: { click: function () { api.tap([{ id: t.done_id, action: "done", token: t.done_token }], "Checked off"); } } }, "Done"),
      r && r.err ? api.h("div.v-task-sub", null, "Not sent: " + r.err)
        : api.reason(t.done_id) ? api.h("div.v-task-sub", null, api.reason(t.done_id)) : null);
  }
  function dueCard(api, s) {
    if (!s.due) return null;
    if (!on(s.due)) return card(api, "Due today and overdue", null, muted(api, "Tasks not read yet"));
    var g = dueGroups(api, s), body = [];
    if (g.overdue.length) body.push(api.h("div.v-sub-head", null, status(api, "wait", "Overdue " + g.overdue.length)));
    g.overdue.forEach(function (t) { body.push(taskRow(api, t)); });
    if (g.today.length) body.push(api.h("div.v-sub-head", null, "Today " + g.today.length));
    g.today.forEach(function (t) { body.push(taskRow(api, t)); });
    if (!g.today.length) {
      // nothing due today: the next dated tasks instead of an empty line
      var soon = g.week.concat(g.later).slice(0, 2);
      if (!soon.length && !g.overdue.length) return null;
      if (soon.length) {
        body.push(api.h("div.v-sub-head" + (body.length ? "" : ".v-sub-first"), null, "Nothing due today. Next up"));
        soon.forEach(function (t) { body.push(taskRow(api, t)); });
      }
    }
    return card(api, g.overdue.length || g.today.length ? "Due today and overdue" : "Tasks", link(api, "All lists", function () { api.go("lists"); }), body);
  }

  /* ---------- inbox ---------- */
  function statLines(api, a) { // one stat per line: label, then the number
    var rows = a.filter(function (x) { return x && x[0] != null; });
    return rows.length ? api.h("div.v-kv", null, rows.map(function (x) { return kvRow(api, x[1], String(x[0])); })) : null;
  }
  function mailRow(api, r) {
    return api.h("div.v-mail", null, api.h("div.v-mail-from", null, r.from), api.h("div.v-mail-sub", null, r.subject));
  }
  function digestRow(api, r) {
    return api.h("div.v-filed", null,
      api.h("div.v-filed-t.v-num", null, r.at ? api.fmtTime(r.at) : ""),
      api.h("div.v-filed-main", null, api.h("div.v-act-title", null, r.text)));
  }
  function unreadText(b) { return b.unread == null ? null : b.unread + (b.unread_capped ? "+" : ""); }
  // What Otto filed today: the inbox block's list (the activity log, one source), or the
  // older snapshot's added_today.
  function filedList(api, s) {
    var b = on(s.inbox) ? s.inbox : {};
    if (b.filed) return b.filed;
    return api.handled(s).map(function (it) { return { at: it.at, text: it.title, agent: it.lead, id: it.id, undo_token: it.undo_token, undo_until: it.undo_until }; });
  }
  // The count: the block's own total (the list it carries is capped), else the list.
  function filedCount(s, filed) {
    var b = on(s.inbox) ? s.inbox : {};
    return b.filed && b.filed_today != null ? b.filed_today : filed.length;
  }
  function filedRow(api, r) {
    var sent = r.id ? api.sent(r.id) : null;
    return api.h("div.v-filed", null,
      api.h("div.v-filed-t.v-num", null, api.fmtTime(r.at)),
      api.h("div.v-filed-main", null, api.h("div.v-ev-title", null, r.text), r.agent ? api.h("div.v-ev-sub", null, "By " + api.nameOf(r.agent)) : null),
      sent && sent.ok !== false ? status(api, "live", "Undone") : r.id && api.undoable(r)
        ? api.h("button.v-btn.v-btn-sm", { type: "button", on: { click: function () { api.send(r.id, "undo", r.undo_token); } } }, "Undo") : null);
  }
  function inboxCard(api, s) {
    var b = s.inbox;
    if (!on(b)) return null;
    var ik = b.mail_counts || {}, filed = filedList(api, s), dg = (b.digest || []).length, fn = filedCount(s, filed);
    var lines = statLines(api, [
      [unreadText(b), "Unread"],
      [ik.read != null ? ik.read : null, "Read by Otto today"],
      [fn || null, "Otto filed today"],
      [dg || null, "Digest lines today"],
      [ik.ignored || null, "Ignored by rule"],
      [ik.waiting || null, "Waiting for the next check"]]);
    if (!lines) return null;
    return card(api, "Inbox", link(api, "Open", function () { api.go("inbox"); }), [
      lines,
      (b.top || []).slice(0, 2).map(function (r) { return mailRow(api, r); })
    ]);
  }

  /* ---------- look-ahead, watching, goals ---------- */
  function lookahead(api, s) {
    var l = s.lookahead;
    if (!on(l)) return null;
    var days = l.days || [];
    return card(api, "Next 7 days", null, days.length ? days.map(function (dy) {
      return api.h("div.v-day", null,
        api.h("div.v-day-head", null, dy.date || api.fmtDayOnly(keyPlus(api, dy.day_offset))),
        (dy.items || []).map(function (it) {
          return api.h("div.v-ev.v-ev-sm", null,
            api.h("div.v-ev-time.v-num", null, it.time),
            api.h("div.v-ev-main", null, api.h("div.v-ev-title", null, it.title)),
            api.h("span.v-tag", null, it.tag));
        }));
    }) : muted(api, "Nothing on the calendar this week"));
  }
  function lineRows(api, rows) {
    return (rows || []).map(function (r) {
      return api.h("div.v-row", null,
        api.h("div.v-row-k", null, r.name),
        api.h("div.v-row-v", null, r.value),
        r.note ? api.h("div.v-row-n", null, r.note) : null);
    });
  }
  function listCard(api, label, b) { // nothing set up: no card at all
    if (!on(b) || !(b.rows || []).length) return null;
    return card(api, label, null, lineRows(api, b.rows));
  }

  /* ---------- sleep and recovery ---------- */
  function sleepCard(api, s) {
    var sl = s.sleep, r = s.recovery;
    if (!on(sl) && !on(r)) return null;
    var hrs = (on(sl) && sl.last_7d) || [], rec = (on(r) && r.last_7d) || [], days = api.lastDays(7), max = 9, goal = sl && sl.goal;
    var bars = api.h("div.v-bars", { role: "img", "aria-label": "Sleep hours, last 7 nights" },
      goal ? api.h("div.v-goal", { style: "bottom:" + Math.round(goal / max * 96) + "px" }) : null,
      days.map(function (dname, i) {
        var v = hrs[i], last = i === days.length - 1;
        return api.h("div.v-bar-col", null,
          api.h("div.v-bar-v.v-num", null, v != null ? v.toFixed(1) + " h" : ""),
          api.h("div.v-bar-track", null, api.h("div.v-bar" + (last ? ".v-bar-now" : ""), { style: "height:" + Math.min(100, (v || 0) / max * 100) + "%" })));
      }));
    var labels = api.h("div.v-bar-labels", null, days.map(function (dn) { return api.h("span", null, dn); }));
    var recRow = rec.some(function (v) { return v != null; }) ? api.h("div.v-rec-row", null, api.h("span.v-rec-k", null, "Recovery"),
      api.h("div.v-rec-vals.v-num", null, rec.map(function (v) { return api.h("span", null, v != null ? v + "%" : ""); }))) : null;
    var src = (on(r) && r.source) || (on(sl) && sl.source) || null;
    return card(api, "Sleep and recovery", src ? api.h("span.v-card-meta", null, src) : null, [hrs.length ? [bars, labels] : null, recRow]);
  }

  /* ---------- system beside the day ---------- */
  function agentRows(s) { return on(s.agents_runs) ? (s.agents_runs.rows || []) : []; }
  function lateAgents(s) { return agentRows(s).filter(function (a) { return a.state === "late"; }); }
  function sysHead(api, s) {
    var p = api.health(s), late = lateAgents(s), n = p.length + late.length;
    if (!n) return api.h("div.v-sys-head", null, status(api, "live", "All systems normal"));
    var first = late.length ? late[0].name + " late" : p[0].short;
    return api.h("div.v-sys-head.v-warn", null, status(api, "wait", n === 1 ? "1 problem: " + first : n + " problems"));
  }
  function pct(a, b) { return Math.round(a / b * 100) + "%"; }
  function kvRow(api, k, v) { return api.h("div.v-kv-row", null, api.h("div.v-kv-k", null, k), api.h("div.v-kv-v.v-num", null, v)); }
  function vmLine(vm) { return pct(vm.ram_used_mb, vm.ram_total_mb) + " (" + vm.ram_used_mb + " of " + vm.ram_total_mb + " MB)"; }
  function soonest(rows, n) {
    return rows.map(function (x) { return { x: x, t: agentNext(x) }; }).filter(function (p) { return p.t; })
      .sort(function (a, b) { return a.t - b.t; }).slice(0, n).map(function (p) { return p.x; });
  }
  function agentRow(api, x, compact) {
    var kind = STATE_KIND[x.state] || "dark", nx = agentNext(x), lines;
    if (x.state === "dark" && !x.last_at && x.cron && nx) {
      // scheduled, never ran: say when, not "No run on record"
      var dl = daily(x.cron);
      lines = [api.h("div", null, dl ? "Daily at " + api.fmtTime(nx) : "Next " + whenLabel(api, nx)),
        api.h("div", null, "First run " + (dl ? dayWord(api, nx) : whenLabel(api, nx)))];
    } else {
      lines = [api.h("div", null, api.h("span.v-runs-k", null, "Ran "), x.last_at ? whenLabel(api, x.last_at) : x.last),
        x.schedule ? api.h("div", null, x.schedule)
          : x.state === "manual" ? api.h("div", null, "On demand")
          : api.h("div", null, api.h("span.v-runs-k", null, "Next "), nx ? whenLabel(api, nx) : x.next)];
    }
    return api.h("div.v-agent" + (compact ? ".v-agent-c" : ""), null,
      api.h("div.v-agent-name", null, x.name, x.note && !compact ? api.h("div.v-agent-note", null, x.note) : null),
      api.h("div.v-agent-runs.v-num", null, lines),
      status(api, kind, STATE_WORD[x.state] || null));
  }
  function systemCard(api, s) {
    var a = agentRows(s), vm = s.vm, c = on(s.decisions) ? (s.decisions.verdicts || [])[0] : null;
    var liveN = a.filter(function (x) { return x.state === "live"; }).length;
    var schedN = a.filter(function (x) { return x.state !== "manual"; }).length;
    return card(api, "Otto and system", link(api, "Open Otto", function () { api.go("otto"); }), [
      sysHead(api, s),
      api.h("div.v-kv", null,
        schedN ? kvRow(api, "Agents on schedule", liveN + " of " + schedN) : null,
        on(vm) ? kvRow(api, "VM memory", vmLine(vm)) : null,
        c ? kvRow(api, "Latest decision", c.title) : null),
      a.length ? [api.h("div.v-sub-head", null, "Next runs"), soonest(a, 4).map(function (x) { return agentRow(api, x, true); })] : null
    ], ".v-card-sys");
  }

  /* ---------- Today ---------- */
  function heading(api, title, sub) {
    return api.h("div.v-head", null, api.h("h1.v-h1", null, title), sub ? api.h("div.v-h1-sub", null, sub) : null);
  }
  function renderToday(s, api) {
    var colA = api.h("div.v-col.v-col-a", null, ord(1, needsCard(api, 3)), ord(2, glance(api, s)), ord(3, timeline(api, s)), ord(7, lookahead(api, s)));
    var colB = api.h("div.v-col.v-col-b", null, ord(4, dueCard(api, s)), ord(5, inboxCard(api, s)),
      ord(8, listCard(api, "Watching", s.watching)), ord(9, listCard(api, "Goals", s.goals)));
    var colC = api.h("div.v-col.v-col-c", null, ord(6, sleepCard(api, s)), ord(10, systemCard(api, s)), ord(11, legend(api)));
    return [heading(api, api.fmtDay(new Date()), "Otto checked " + api.fmtTime(s.generated)),
      api.h("div.v-grid", null, colA, colB, colC)];
  }

  /* ---------- Inbox ---------- */
  function eventMini(api, it) {
    var c = api.calPreview(it);
    return api.h("div.v-evcard", null,
      api.h("div.v-evcard-date", null, api.h("div.v-evcard-mon", null, c.month), api.h("div.v-evcard-num.v-num", null, c.num), api.h("div.v-evcard-day", null, c.day)),
      api.h("div.v-evcard-info", null,
        api.h("div.v-evcard-title", null, c.title),
        c.time ? api.h("div.v-evcard-sub.v-num", null, c.time) : null,
        c.place ? api.h("div.v-evcard-sub", null, c.place) : null,
        c.calendar ? api.h("div.v-evcard-sub", null, "To " + c.calendar + " Calendar") : null));
  }
  function needFull(api, it) {
    var kind = api.previewKind(it), done = sentLine(api, it), reason = api.reason(it.id);
    var prev = kind === "event" ? eventMini(api, it)
      : kind === "reply" ? (function () { var r = api.replyPreview(it); return api.h("div.v-replyprev", null, r.to ? api.h("div.v-evcard-sub", null, "To " + r.to) : null, api.h("div.v-replyprev-text", null, r.text)); })()
      : api.h("div.v-lineprev", null, api.preview(it));
    return api.h("article.v-card.v-needfull", null,
      api.h("div.v-need-meta", null, api.h("span.v-tag", null, api.typeLabel(it)), it.area ? api.h("span.v-tag", null, it.area) : null,
        it.decide_today ? status(api, "wait", "Decide today") : null),
      api.h("div.v-need-title.v-big", null, it.title),
      api.h("div.v-need-why", null, api.whyText(it.why)),
      prev,
      api.h("div.v-need-by", null, "From " + api.nameOf(it.agent) + ", " + api.ago(it.created)),
      reason ? api.h("div.v-need-why", null, reason) : null,
      done || buttons(api, it));
  }
  function renderInbox(s, api) {
    var needs = openNeeds(api), filed = filedList(api, s), b = on(s.inbox) ? s.inbox : {}, ik = b.mail_counts || {};
    var dg = b.digest || [], cards = [], fn = filedCount(s, filed);
    if (needs.length) cards.push(api.h("div.v-sub-head.v-sub-first", null, status(api, "wait", "Needs you " + needs.length)),
      needs.map(function (it) { return needFull(api, it); }));
    if (on(s.inbox)) {
      var did = fn || dg.length || needs.length;
      var lines = statLines(api, [
        [ik.read != null ? ik.read : null, "Read today"],
        [fn || null, "Filed"],
        [dg.length || null, "Digest lines"],
        [ik.ignored || null, "Ignored by rule"],
        [ik.waiting || null, "Waiting for the next check"]]);
      cards.push(card(api, "Otto's mail today", null, [
        !did && ik.read != null ? api.h("div.v-sys-head", null, status(api, "live", "Otto read " + api.plural(ik.read, "email") + " today, nothing needed you")) : null,
        lines,
        filed.length ? [api.h("div.v-sub-head", null, "Filed"), filed.map(function (r) { return filedRow(api, r); })] : null,
        dg.length ? [api.h("div.v-sub-head", null, "Digest lines"), dg.map(function (r) { return digestRow(api, r); })] : null
      ]));
      if (b.unread != null && (b.unread || (b.top || []).length)) {
        cards.push(card(api, "Unread, primary", api.h("span.v-card-meta.v-num", null, unreadText(b)),
          (b.top || []).map(function (r) { return mailRow(api, r); })));
      } else if (b.unread === 0) {
        cards.push(api.h("div.v-muted-line", null, "Primary inbox is at zero unread"));
      }
    } else {
      cards.push(muted(api, "Mail not read this check"));
    }
    return [heading(api, "Inbox", null), dayStrip(api, s), api.h("div.v-stack", null, cards, legend(api))];
  }

  /* ---------- Lists ---------- */
  function renderLists(s, api) {
    var u = s.due || {}, items = u.items || [], clinical = u.clinical || {};
    if (!on(u)) return [heading(api, "Lists"), muted(api, "Tasks not read yet")];
    var names = ["My List", "OSMC", "EMB", "Golf", "Spectrum"];
    var count = function (n) { return items.filter(function (t) { return t.list === n; }).length + (clinical[n] || 0); };
    var total = items.length + Object.keys(clinical).reduce(function (a, k) { return a + clinical[k]; }, 0);
    var chips = api.h("div.v-chips", null, [["All", total]].concat(names.map(function (n) { return [n, count(n)]; })).map(function (c) {
      var sel = ui.list === c[0];
      return api.h("button.v-chip" + (sel ? ".v-on" : ""), { type: "button", "aria-pressed": sel ? "true" : "false",
        on: { click: function () { ui.list = c[0]; api.render(); } } }, c[0], api.h("span.v-chip-n.v-num", null, String(c[1])));
    }));
    var pick = function (t) { return ui.list === "All" || t.list === ui.list; };
    var g = dueGroups(api, { due: { items: items.filter(pick) } });
    var groups = [
      ["Overdue", g.overdue, true], ["Today", g.today], ["This week", g.week], ["Later", g.later], ["No date", g.none]
    ].filter(function (x) { return x[1].length; }).map(function (x) {
      return card(api, null, null, [
        api.h("div.v-sub-head.v-sub-first", null, x[2] ? status(api, "wait", x[0] + " " + x[1].length) : x[0] + " " + x[1].length),
        x[1].map(function (t) { return taskRow(api, t, x[0] === "Today" || x[0] === "No date"); })]);
    });
    var clin = Object.keys(clinical).filter(function (k) { return pick({ list: k }) && clinical[k]; }).map(function (k) {
      return muted(api, k + ": " + api.plural(clinical[k], "clinical task"));
    });
    return [heading(api, "Lists", null), dayStrip(api, s), chips,
      api.h("div.v-stack", null, groups.length ? groups : muted(api, "Nothing open"), clin, legend(api))];
  }

  /* ---------- Otto ---------- */
  function renderOtto(s, api) {
    var pf = on(s.platform) ? s.platform : {}, a = agentRows(s), vm = s.vm, c = on(s.decisions) ? (s.decisions.verdicts || []) : [];
    var statusCard = card(api, "Status", null, [
      sysHead(api, s),
      api.h("div.v-kv", null,
        kvRow(api, "Last check", api.fmtTime(s.generated)),
        pf.self_update ? kvRow(api, "Updated", whenLabel(api, pf.self_update)) : null)
    ]);
    var agents = a.length ? card(api, "Agents", api.h("span.v-card-meta", null, a.length + " on the roster"),
      a.map(function (x) { return agentRow(api, x, false); })) : null;
    var vmCard = on(vm) ? card(api, "VM", vm.uptime ? api.h("span.v-card-meta", null, "Up " + vm.uptime) : null, [
      api.h("div.v-meter", { role: "img", "aria-label": "Memory used" }, api.h("div.v-meter-fill", { style: "width:" + pct(vm.ram_used_mb, vm.ram_total_mb) })),
      api.h("div.v-kv", null,
        kvRow(api, "Memory", vmLine(vm)),
        vm.swap_used_mb != null ? kvRow(api, "Swap used", vm.swap_used_mb + " MB") : null,
        vm.load1 != null ? kvRow(api, "Load", String(vm.load1)) : null,
        kvRow(api, "Sampled", api.fmtTime(vm.as_of)))
    ]) : null;
    var act = card(api, "Activity", null, (s.timeline || []).length ? (s.timeline || []).slice(0, 7).map(function (e) {
      var bad = e.result === "failed" || e.result === "error";
      return api.h("div.v-filed", null,
        api.h("div.v-filed-t.v-num", null, api.fmtTime(e.ts)),
        api.h("div.v-filed-main", null, api.h("div.v-act-title", null, e.summary || api.OPS[e.action] || e.action), api.h("div.v-ev-sub", null, api.nameOf(e.agent))),
        bad ? status(api, "wait", "Failed") : status(api, "live", "Done"));
    }) : muted(api, "No activity yet"));
    var decisions = c.length ? card(api, "Decisions on record", null, c.map(function (v) {
      return api.h("div.v-verdict", null, api.h("div.v-ev-sub", null, v.date), api.h("div.v-ev-title", null, v.title), v.line ? api.h("div.v-ev-sub", null, v.line) : null);
    })) : null;
    var net = window.OttoNetwork && window.OttoNetwork.renderMap;
    var mapCard = card(api, "Team map and gates", link(api, ui.map ? "Hide" : "Show", function () { ui.map = !ui.map; api.render(); }),
      ui.map && net ? api.h("div.v-map", null, net(s, api)) : muted(api, api.plural((s.gates || []).length, "gate") + ", map hidden"));
    return [heading(api, "Otto", null), dayStrip(api, s),
      api.h("div.v-grid.v-grid-otto", null,
        api.h("div.v-col", null, ord(1, statusCard), ord(3, vmCard), ord(5, decisions),
          ord(6, listCard(api, "Watching", s.watching)), ord(7, listCard(api, "Goals", s.goals))),
        api.h("div.v-col", null, ord(2, agents)),
        api.h("div.v-col", null, ord(4, act), ord(8, mapCard), ord(9, legend(api)), ord(10, api.lookPicker())))];
  }

  /* ---------- chrome: wordmark, text tabs, toast ---------- */
  function renderTop(s, api) {
    var n = s ? openNeeds(api).length : 0;
    return [
      api.h("div.v-brand", null,
        api.h("span.v-word", null, api.h("span.v-word-a", null, "Otto"), api.h("span.v-word-b", null, "OS"))),
      api.h("div.v-top-right", null,
        n ? api.h("button.v-pill", { type: "button", on: { click: function () { api.go("inbox"); } } }, shape(api, "wait"), api.h("span.v-num", null, n + " need you"))
          : status(api, "live", "Clear"),
        api.DEMO ? api.h("span.v-demo", null, "Demo") : null)
    ];
  }
  function renderTabs(s, api) {
    var n = s ? openNeeds(api).length : 0, cur = api.tab();
    return api.tabs().map(function (t) {
      var sel = cur === t.id;
      return api.h("button.v-tab" + (sel ? ".v-on" : ""), { type: "button", "aria-current": sel ? "page" : null,
        on: { click: function () { api.go(t.id); } } },
        api.h("span.v-tab-l", null, t.short),
        t.id === "inbox" && n ? api.h("span.v-badge.v-num", null, String(n)) : null);
    });
  }
  function renderToast(t, api) {
    return [api.h("span.v-toast-text", null, shape(api, "live"), api.h("span", null, t.text)),
      api.h("button.v-toast-undo", { type: "button", on: { click: t.onUndo } }, "Undo")];
  }

  window.OttoHome.register("v3", {
    label: "OttoOS",
    standalone: true,
    themeColor: "#0B0C0E",
    tabs: [
      { id: "today", short: "Today", title: "Today", fn: "renderToday" },
      { id: "inbox", short: "Inbox", title: "Inbox", fn: "renderInbox" },
      { id: "lists", short: "Lists", title: "Lists", fn: "renderLists" },
      { id: "otto", short: "Otto", title: "Otto", fn: "renderOtto" }
    ],
    alias: { needs: "inbox", activity: "otto", system: "otto", working: "otto", built: "otto" },
    renderToday: renderToday,
    renderInbox: renderInbox,
    renderLists: renderLists,
    renderOtto: renderOtto,
    renderActivity: renderOtto,
    renderSystem: renderOtto,
    renderToast: renderToast,
    renderTop: renderTop,
    renderTabs: renderTabs
  });
})();
