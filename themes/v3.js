/* OttoOS v3, the production look. Four text tabs: Today (the Needs you bar, the weather,
   the day as a calendar grid, tasks, mail, recovery), Inbox (decisions, filed today, unread
   mail), Lists (tasks by date) and OttoOS (agents, VM, activity, decisions on record).
   The Needs you bar opens #needs: the decisions only, nothing else.
   Reads the v3 snapshot blocks (today, weather, recovery, sports, truck, due, inbox,
   lookahead, watching, goals, platform, agents_runs, vm, decisions). Any block may be
   missing or { connected: false }: a glance tile is then left out, a card collapses to
   one muted line or is left out. Rendering only: every tap goes through api.send;
   no fetch, no storage, text nodes only. No icons anywhere: tabs are words. */
(function () {
  "use strict";
  if (!window.OttoHome) return;

  var ui = { list: "All", map: false };

  /* ---------- small helpers ---------- */
  // Status = a word, coloured amber when it waits on you. No icons or shapes anywhere
  // (2026-10-20), so there is no legend to decode them either.
  // Kinds: live (on schedule / done), run (working now), dry (dry run), dark (off), wait (waiting on you, late, overdue).
  var KIND = {
    live: { word: "Live" }, ok: { word: "OK" }, run: { word: "Running" }, dry: { word: "Dry run" },
    dark: { word: "Off" }, wait: { word: "Needs you" }, late: { word: "Late" }
  };
  var STATE_KIND = { live: "live", running: "run", dry_run: "dry", dark: "dark", dormant: "dark", manual: "dark", late: "late", needs_you: "wait" };
  var STATE_WORD = { live: "On schedule", late: "Late", manual: "Manual", dark: "No run yet" };
  var VERB_WORD = { done: "Done", approve: "Approve", deny: "Deny", snooze: "Later" };
  function status(api, kind, word) {
    return api.h("span.v-status.v-s-" + kind, null, api.h("span", null, word || (KIND[kind] || {}).word || ""));
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
  // ISO dates in logged text ("due 2026-10-22") read as written-out dates ("due October 22").
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function words(text) {
    return String(text == null ? "" : text).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, function (m, y, mo, dd) {
      var i = +mo - 1;
      if (i < 0 || i > 11) return m;
      return MONTHS[i] + " " + (+dd) + (+y !== new Date(nowMs()).getFullYear() ? ", " + y : "");
    });
  }
  function ord(n, node) { if (node && node.style) node.style.order = n; return node; }

  /* ---------- schedules: the snapshot carries each agent's cron lines (UTC, as the VM
     runs them); the next run is computed (api.nextFire, app.js) against this device's
     clock, so a snapshot read later never shows a next run that already went by. ---------- */
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
  function list(set, lo, hi) { var o = []; for (var x = lo; x <= hi; x++) if (has(set, x)) o.push(x); return o; }
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
  function agentNext(api, x) {
    if (x.cron) return api.nextFire(x.cron, nowMs());
    var t = x.next_at ? api.d(x.next_at) : null;
    return t && t.getTime() > nowMs() ? t : null;          // never a Next in the past
  }
  // A row's state is as of the snapshot. When no new snapshot is coming soon (the night
  // gap: the orchestrator's next scheduled tick is far off) or the next one is overdue
  // (api.snapLate), and a run of this agent was due after the snapshot, the app cannot
  // know how that run went: the row says Not checked instead of On schedule. A tick that
  // is a few minutes late in the day never flips the rows.
  var GAP_MS = 35 * 60000, RUN_GRACE_MS = 5 * 60000;
  function waiting(api, s) { // true while the snapshot cannot vouch for later runs
    var g = api.d(s && s.generated), ns = api.nextSnapshot(s);
    if (!g) return false;
    return (!!ns && ns.getTime() - g.getTime() > GAP_MS) || api.snapLate(s, nowMs(), 30);
  }
  function unchecked(api, s, x) {
    var g = api.d(s && s.generated), now = nowMs();
    if (!g || x.state === "manual" || x.schedule || !waiting(api, s)) return false;
    if (x.cron) { var n = api.nextFire(x.cron, g.getTime()); return !!n && n.getTime() + RUN_GRACE_MS < now; }
    var t = x.next_at ? api.d(x.next_at) : null;
    return !!t && t.getTime() + RUN_GRACE_MS < now;
  }

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
  var TRUCK_STALE_MS = 2 * 3600000;
  // "10:36 AM today", else "Friday, October 16, 10:36 AM": written-out date, 12-hour time.
  function asOfLabel(api, x) {
    if (api.dayKey(x) === todayKey(api)) return api.fmtTime(x) + " today";
    return x.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" }) + ", " + api.fmtTime(x);
  }
  function glance(api, s) {
    // Weather is its own full-width card and recovery its own card (as in the Daily Email,
    // no recovery number anywhere else), so the tiles are the game or week, and the truck.
    var sp = s.sports, t = s.truck, tiles = [];
    if (on(sp) && sp.game) {
      tiles.push(tile(api, "Game today", sp.game.headline, [api.fmtTime(sp.game.time), sp.game.channel ? "On " + sp.game.channel : null], ".v-tile-text"));
    } else {
      var wk = weekTile(api, s);
      if (wk) tiles.push(wk);
    }
    if (on(t) && t.fuel_pct != null) {
      // the Colorado card rule: GM's own numbers, with "As of <time>" once they are stale
      var asOf = api.d(t.as_of), old = asOf && nowMs() - asOf.getTime() > TRUCK_STALE_MS;
      tiles.push(tile(api, t.name || "Truck", t.fuel_pct + "%", [t.gallons != null ? t.gallons + " gal" : null, t.range_mi != null ? "Range " + t.range_mi + " mi" : null,
        old ? "As of " + asOfLabel(api, asOf) : t.odometer ? "Odometer " + String(t.odometer).replace(" mi", "") : null]));
    }
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

  /* ---------- Today: the day as a calendar grid (Google Calendar's day view) ----------
     Hour rows, each timed event a block sized by its length, all-day events in a row on
     top, a "now" line. Each block wears the color of its calendar (today.colors: the
     colors from Google Calendar itself) and always prints the calendar name as text, so
     color is never the only cue. A clinical block is its calendar name and time only. */
  var HOUR_PX = 52, MIN_BLOCK_PX = 26;
  function ctMin(x) {
    var p = x.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour12: false, hour: "2-digit", minute: "2-digit" });
    var m = /(\d+):(\d+)/.exec(p);
    return m ? ((+m[1]) % 24) * 60 + (+m[2]) : 0;
  }
  function hourWord(h) { var hh = h % 24; return (hh % 12 || 12) + (hh < 12 ? " AM" : " PM"); }
  function calColor(t, tag) {
    var c = ((t && t.colors) || {})[tag];
    return /^#[0-9A-Fa-f]{6}$/.test(c || "") ? c : null;
  }
  function luminance(hex) {
    var v = [1, 3, 5].map(function (i) {
      var c = parseInt(hex.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  // The text color with the higher contrast on the calendar color (white on black, dark on yellow).
  function inkOn(hex) {
    var l = luminance(hex);
    return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#FFFFFF" : "#111111";
  }
  function blockStyle(t, e, extra) {
    var c = calColor(t, e.tag);
    return (c ? "background:" + c + ";color:" + inkOn(c) + ";" : "") + (extra || "");
  }
  function spanText(api, e) {
    if (!e.end) return api.fmtTime(e.start);
    return api.fmtTime(e.start) + " to " + api.fmtTime(e.end);
  }
  // Overlapping events share the width: each gets a column inside its cluster.
  function columns(rows) {
    var out = [], cluster = [], cEnd = -1;
    function flush() {
      var cols = [];
      cluster.forEach(function (r) {
        var i = 0;
        while (cols[i] != null && cols[i] > r.a) i++;
        cols[i] = r.b; r.col = i;
      });
      cluster.forEach(function (r) { r.n = cols.length; out.push(r); });
      cluster = []; cEnd = -1;
    }
    rows.forEach(function (r) {
      if (cluster.length && r.a >= cEnd) flush();
      cluster.push(r); cEnd = Math.max(cEnd, r.b);
    });
    if (cluster.length) flush();
    return out;
  }
  function timeline(api, s) {
    var t = s.today;
    if (!t) return null;
    if (!on(t)) return card(api, "Today", null, muted(api, "Calendar not read this check"));
    var all = (t.events || []).filter(function (e) { return api.d(e.start); });
    var allDay = all.filter(function (e) { return e.all_day; });
    var now = nowMs(), nowM = ctMin(new Date(now)), isToday = !t.as_of || api.dayKey(t.as_of) === todayKey(api);
    var rows = all.filter(function (e) { return !e.all_day; }).map(function (e) {
      var x = api.d(e.start), y = e.end ? api.d(e.end) : null, a = ctMin(x);
      var b = y ? (api.dayKey(y) !== api.dayKey(x) ? 24 * 60 : ctMin(y)) : a + 30;
      return { e: e, a: a, b: Math.max(b, a + 15), past: (y ? y.getTime() : x.getTime() + 30 * 60000) < now };
    }).sort(function (p, q) { return p.a - q.a || q.b - p.b; });
    if (!rows.length && !allDay.length) {
      return card(api, "Today", null, [muted(api, "Nothing on the calendar today"), t.footer ? api.h("div.v-foot", null, t.footer) : null]);
    }
    var lo = 24, hi = 0;
    rows.forEach(function (r) { lo = Math.min(lo, Math.floor(r.a / 60)); hi = Math.max(hi, Math.ceil(r.b / 60)); });
    if (isToday) { lo = Math.min(lo, Math.floor(nowM / 60)); hi = Math.max(hi, Math.floor(nowM / 60) + 1); }
    if (!rows.length && !isToday) { lo = 8; hi = 17; }
    if (hi - lo < 4) hi = Math.min(24, lo + 4);
    if (hi - lo < 4) lo = Math.max(0, hi - 4);
    var hours = [];
    var nowTop = isToday ? (nowM - lo * 60) / 60 * HOUR_PX : -999;
    // one line per hour, the closing hour included, every row HOUR_PX tall; a block's top
    // and bottom land on the lines for its start and end (less a 2 px gap at the bottom)
    for (var h = lo; h <= hi; h++) {
      // the now label takes the gutter: an hour label it would sit on is left out
      var hidden = Math.abs((h - lo) * HOUR_PX - nowTop) < 24;
      hours.push(api.h("div.v-cal-hour", { style: "top:" + (h - lo) * HOUR_PX + "px" },
        hidden ? null : api.h("span.v-cal-hl.v-num", null, hourWord(h))));
    }
    var blocks = columns(rows).map(function (r) {
      var e = r.e, top = Math.round((r.a - lo * 60) / 60 * HOUR_PX), ht = Math.max(MIN_BLOCK_PX, Math.round((r.b - r.a) / 60 * HOUR_PX) - 2);
      var w = 100 / r.n, pos = "top:" + top + "px;height:" + ht + "px;left:calc(" + (r.col * w) + "% + 2px);width:calc(" + w + "% - 4px);";
      return api.h("div.v-cal-b" + (r.past ? ".v-past" : "") + (calColor(t, e.tag) ? "" : ".v-cal-plain"), { style: blockStyle(t, e, pos) },
        api.h("div.v-cal-bt", null, api.h("span.v-cal-tag", null, e.tag), e.clinical ? null : " " + e.title),
        api.h("div.v-cal-bs.v-num", null, spanText(api, e)),
        e.place && !e.clinical ? api.h("div.v-cal-bs", null, e.place) : null);
    });
    var nowLine = isToday && nowM >= lo * 60 && nowM <= hi * 60
      ? api.h("div.v-cal-now", { "aria-label": "Now", style: "top:" + Math.round((nowM - lo * 60) / 60 * HOUR_PX) + "px" },
        api.h("span.v-cal-nowt.v-num", null, api.fmtTime(new Date(now))), api.h("span.v-cal-nowl"))
      : null;
    var top = allDay.length ? api.h("div.v-cal-allday", null,
      api.h("div.v-cal-adl", null, "All day"),
      api.h("div.v-cal-adlist", null, allDay.map(function (e) {
        return api.h("div.v-cal-chip" + (calColor(t, e.tag) ? "" : ".v-cal-plain"), { style: blockStyle(t, e) },
          api.h("span.v-cal-tag", null, e.tag), e.clinical ? null : " " + e.title);
      }))) : null;
    var grid = rows.length || isToday ? api.h("div.v-cal-grid", { style: "height:" + (hi - lo) * HOUR_PX + "px" },
      hours, api.h("div.v-cal-events", null, blocks), nowLine) : null;
    var conflicts = (t.conflicts || []).map(function (c) {
      return api.h("div.v-conflict", null, status(api, "wait", "Conflict " + api.fmtTime(c.at)), api.h("span.v-conflict-x", null, c.text));
    });
    return card(api, "Today", api.h("span.v-card-meta", null, api.plural(all.length, "event")),
      [top, grid, conflicts, t.footer ? api.h("div.v-foot", null, t.footer) : null], ".v-card-cal");
  }

  /* ---------- conflicts in the next 14 days (hidden when there are none) ---------- */
  function conflictsCard(api, s) {
    var t = s.today, rows = on(t) ? (t.conflicts_ahead || []) : [];
    if (!rows.length) return null;
    return card(api, "Conflicts", api.h("span.v-card-meta", null, api.plural(rows.length, "conflict")),
      rows.map(function (c) {
        return api.h("div.v-conflict-row", null,
          api.h("div.v-ev-sub", null, status(api, "wait", c.day || api.fmtDay(c.at))),
          api.h("div.v-ev-title", null, c.text));
      }), ".v-card-needs");
  }

  /* ---------- Needs You ---------- */
  function sentLine(api, it) {
    var r = api.sent(it.id);
    if (!r || r.ok === false) return null;
    return api.h("div.v-sent", null, status(api, "live", (api.DONE_WORD[r.action] || "Sent") + (r.held ? ", sending" : "")));
  }
  function verbs(it) {
    var allowed = it.actions || ["approve", "deny", "snooze"];
    return ["done", "approve", "deny", "snooze"].filter(function (v) { return allowed.indexOf(v) >= 0; });
  }
  function buttons(api, it) {
    return api.h("div.v-btns", null, verbs(it).map(function (v, i) {
      return api.h("button.v-btn" + (i === 0 ? ".v-primary" : ""), { type: "button",
        on: { click: function () { api.send(it.id, v, api.tokenFor(it, v)); } } }, VERB_WORD[v]);
    }));
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
      bare ? null : api.h("div.v-task-when.v-num", null, api.h("span", null, when)),
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
      api.h("div.v-filed-main", null, api.h("div.v-act-title", null, words(r.text))));
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
      api.h("div.v-filed-main", null, api.h("div.v-ev-title", null, words(r.text)), r.agent ? api.h("div.v-ev-sub", null, "By " + api.nameOf(r.agent)) : null),
      sent && sent.ok !== false ? status(api, "live", "Undone") : r.id && api.undoable(r)
        ? api.h("button.v-btn.v-btn-sm", { type: "button", on: { click: function () { api.send(r.id, "undo", r.undo_token); } } }, "Undo") : null);
  }
  function sortedTotal(b) {
    var n = (b && b.sorted) || {};
    return (n.receipts || 0) + (n.refunds || 0) + (n.bills || 0);
  }
  var FILED_WORDS = "Turned into tasks or events", DIGEST_WORDS = "Saved for tonight's rundown";
  function inboxCard(api, s) {
    var b = s.inbox;
    if (!on(b)) return null;
    var ik = b.mail_counts || {}, filed = filedList(api, s), dg = (b.digest || []).length, fn = filedCount(s, filed);
    var lines = statLines(api, [
      [unreadText(b), "Unread"],
      [ik.read != null ? ik.read : null, "Read today, new and older"],
      [fn || null, FILED_WORDS],
      [dg || null, DIGEST_WORDS],
      [sortedTotal(b) || null, "Receipts and bills sorted"],
      [ik.waiting || null, "Waiting to be read"]]);
    if (!lines) return null;
    return card(api, "Inbox", api.h("a.v-link", { href: GMAIL_APP, "aria-label": "Open Gmail",
      on: { click: function (ev) { ev.preventDefault(); openGmail(); } } }, "Open"), [
      lines,
      (b.top || []).slice(0, 2).map(function (r) { return mailRow(api, r); })
    ]);
  }

  /* ---------- watching, goals ---------- */
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


  /* ---------- system beside the day ---------- */
  function agentRows(s) { return on(s.agents_runs) ? (s.agents_runs.rows || []) : []; }
  function lateAgents(s) { return agentRows(s).filter(function (a) { return a.state === "late"; }); }
  // One problem list for the top bar, Today's system card and the Otto tab.
  function problems(api, s) {
    if (!s) return [];
    return lateAgents(s).map(function (a) { return { short: a.name + " late" }; }).concat(api.health(s));
  }
  function nextCheckRow(api, s) { // the next scheduled check; none once it is overdue
    var ns = api.nextSnapshot(s);
    return ns && ns.getTime() > nowMs() ? kvRow(api, "Next check", whenLabel(api, ns)) : null;
  }
  function anyUnchecked(api, s) { return agentRows(s).some(function (x) { return unchecked(api, s, x); }); }
  function sysHead(api, s) {
    var p = problems(api, s), n = p.length;
    if (!n && anyUnchecked(api, s)) return api.h("div.v-sys-head", null, status(api, "live", "Normal at the last check"));
    if (!n) return api.h("div.v-sys-head", null, status(api, "live", "All systems normal"));
    var first = p[0].short;
    return api.h("div.v-sys-head.v-warn", null, status(api, "wait", n === 1 ? "1 problem: " + first : n + " problems"));
  }
  function pct(a, b) { return Math.round(a / b * 100) + "%"; }
  function kvRow(api, k, v) { return api.h("div.v-kv-row", null, api.h("div.v-kv-k", null, k), api.h("div.v-kv-v.v-num", null, v)); }
  function vmLine(vm) { return pct(vm.ram_used_mb, vm.ram_total_mb) + " (" + vm.ram_used_mb + " of " + vm.ram_total_mb + " MB)"; }
  function agentRow(api, s, x, compact) {
    var kind = STATE_KIND[x.state] || "dark", nx = agentNext(api, x), lines, word = STATE_WORD[x.state] || null;
    if (x.gate === "dark") { kind = "dark"; word = "Off"; }
    else if (x.gate === "dry_run" && x.state === "live") { kind = "dry"; word = "Dry run"; }
    else if (x.state !== "late" && unchecked(api, s, x)) { kind = "dark"; word = "Not checked"; }
    if (x.state === "dark" && !x.last_at && x.cron && nx) {
      // scheduled, never ran: say when, not "No run on record"
      var dl = daily(x.cron);
      lines = [api.h("div", null, dl ? "Daily at " + api.fmtTime(nx) : "Next " + whenLabel(api, nx)),
        api.h("div", null, "First run " + (dl ? dayWord(api, nx) : whenLabel(api, nx)))];
    } else {
      lines = [api.h("div", null, api.h("span.v-runs-k", null, "Ran "), x.last_at ? whenLabel(api, x.last_at) : x.last),
        x.schedule ? api.h("div", null, x.schedule)
          : x.state === "manual" ? api.h("div", null, "On demand")
          : nx ? api.h("div", null, api.h("span.v-runs-k", null, "Next "), whenLabel(api, nx))
          : x.cron || x.next_at ? null : api.h("div", null, x.next)];
    }
    return api.h("div.v-agent" + (compact ? ".v-agent-c" : ""), null,
      api.h("div.v-agent-name", null, x.name, x.note && !compact ? api.h("div.v-agent-note", null, x.note) : null),
      api.h("div.v-agent-runs.v-num", null, lines),
      status(api, kind, word));
  }

  /* ---------- Weather: full width, the card shows the sky outside ----------
     Like the phone's weather wallpaper: the backdrop follows the current Open-Meteo
     weather code (else the day's sky word), with a night version between sunset and
     sunrise. Pure CSS layers (gradients, drifting clouds, falling rain or snow), still
     under prefers-reduced-motion. The words carry the reading; the sky is only backdrop.
     window.OTTO_WX_FORCE = { kind, night } pins it (screenshots and tests only). */
  var WX_WORD = { clear: "Sunny", partly: "Partly cloudy", cloudy: "Cloudy", rain: "Rain", storm: "Thunderstorm", snow: "Snow", fog: "Fog" };
  function wxKind(code, sky) {
    if (code != null && !isNaN(+code)) {
      var c = +code;
      if (c === 0 || c === 1) return "clear";
      if (c === 2) return "partly";
      if (c === 45 || c === 48) return "fog";
      if (c >= 95) return "storm";
      if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
      if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
      return "cloudy";
    }
    var w = String(sky || "").toLowerCase();
    if (/thunder/.test(w)) return "storm";
    if (/snow|flurr|sleet/.test(w)) return "snow";
    if (/rain|drizzle|shower/.test(w)) return "rain";
    if (/fog|mist|haze/.test(w)) return "fog";
    if (/partly|mostly clear/.test(w)) return "partly";
    if (/clear|sun/.test(w)) return "clear";
    return w ? "cloudy" : null;
  }
  function wxNight(api, w, now) {
    var up = api.d(w.sunrise), down = api.d(w.sunset);
    if (up && down && api.dayKey(up) === api.dayKey(new Date(now))) return now < up.getTime() || now >= down.getTime();
    if (w.is_day === false) return true;
    if (w.is_day === true) return false;
    var m = ctMin(new Date(now));
    return m < 7 * 60 || m >= 19 * 60;
  }
  function wxState(api, w) {
    var f = window.OTTO_WX_FORCE;
    if (f && WX_WORD[f.kind]) return { kind: f.kind, night: !!f.night };
    var kind = wxKind(w.code, w.now_sky || w.sky);
    return kind ? { kind: kind, night: wxNight(api, w, nowMs()) } : null;
  }
  function weatherCard(api, s) {
    var w = s.weather;
    if (!on(w) || w.hi == null) return null;
    var st = wxState(api, w), kind = st ? st.kind : "cloudy", night = st ? st.night : false;
    var word = (w.now_sky || w.sky) || WX_WORD[kind];
    if (night && kind === "clear" && /sunny|mostly clear/i.test(word)) word = "Clear";
    if (window.OTTO_WX_FORCE && st) word = night && kind === "clear" ? "Clear" : WX_WORD[kind];
    var up = api.d(w.sunrise), down = api.d(w.sunset), now = nowMs(), sun = null;
    if (up && now < up.getTime()) sun = "Sunrise " + api.fmtTime(up);
    else if (down && now < down.getTime()) sun = "Sunset " + api.fmtTime(down);
    var lines = [w.now != null ? "High " + w.hi + "°" : null, w.now != null ? "Low " + w.lo + "°" : null,
      w.wind, w.rain, sun].filter(Boolean);
    return api.h("section.v-wx.v-wx-" + kind + (night ? ".v-wx-night" : ""), { "aria-label": "Weather, " + word, "data-wx": kind + (night ? "-night" : "") },
      api.h("div.v-wx-sky"), api.h("div.v-wx-glow"), api.h("div.v-wx-clouds"), api.h("div.v-wx-fall"), api.h("div.v-wx-flash"), api.h("div.v-wx-scrim"),
      api.h("div.v-wx-body", null,
        api.h("div.v-wx-main", null,
          api.h("h2.v-wx-k", null, "Weather"),
          api.h("div.v-wx-big.v-num" + (w.now != null ? "" : ".v-wx-pair"), null, w.now != null ? w.now + "°" : w.hi + "° / " + w.lo + "°"),
          api.h("div.v-wx-word", null, word)),
        api.h("div.v-wx-lines.v-num", null, lines.map(function (l) { return api.h("div", null, l); }))));
  }

  /* ---------- Needs you: the bar on top of Today, and its own view (#needs) ---------- */
  function needsBar(api) {
    var list = openNeeds(api), first = list[0];
    return api.h("button.v-needbar" + (list.length ? ".v-needbar-on" : ""), { type: "button", "aria-label": list.length ? "Needs you, " + list.length + ", open" : "Nothing waiting on you",
      on: { click: function () { api.go("needs"); } } },
      api.h("div.v-needbar-head", null,
        api.h("span.v-needbar-k", null, "Needs you"),
        api.h("span.v-needbar-n.v-num", null, list.length ? String(list.length) : "")),
      api.h("div.v-needbar-t", null, first ? first.title : "Nothing waiting on you"),
      list.length > 1 ? api.h("div.v-needbar-more", null, "And " + (list.length - 1) + " more") : null);
  }
  // The decisions only: Approve / Deny / Later, or Done / Deny. Nothing else on the page.
  function renderNeeds(s, api) {
    var list = openNeeds(api);
    return [api.h("div.v-head.v-head-row", null, api.h("h1.v-h1", null, "Needs you"),
      link(api, "Back to Today", function () { api.go("today"); })),
      api.h("div.v-stack", null, list.length ? list.map(function (it) { return needFull(api, it); })
        : muted(api, "Nothing waiting on you"))];
  }

  /* ---------- Recovery: the Daily Email's recovery card, same labels, same order ----------
     Prev day strain, Recovery, Sleep; then HRV, Rest HR, Avg HR, Sleep consistency;
     then sleep stages with need and debt. A field the fetch did not record is left out. */
  function hmText(h) {
    if (h == null) return null;
    var m = Math.round(h * 60);
    return Math.floor(m / 60) + "h " + (m % 60) + "m";
  }
  function minText(m) { return m == null ? null : Math.floor(m / 60) + "h " + (m % 60) + "m"; }
  function ring(api, cls, frac, big, sub, label) {
    var p = Math.max(0, Math.min(1, frac || 0)) * 100;
    return api.h("div.v-wh-ring" + cls, null,
      api.h("div.v-wh-dial", { style: "--p:" + p.toFixed(1) },
        api.h("div.v-wh-in", null, api.h("div.v-wh-big.v-num", null, big), sub ? api.h("div.v-wh-sub.v-num", null, sub) : null)),
      api.h("div.v-wh-lab", null, label));
  }
  function whoopCard(api, s) {
    var r = s.recovery;
    if (!on(r) || r.recovery_pct == null) return null;
    var zone = r.recovery_pct >= 67 ? "hi" : r.recovery_pct >= 34 ? "mid" : "lo";
    var sleepH = r.sleep_h != null ? r.sleep_h : null;
    var sleepWords = sleepH != null ? hmText(sleepH) : r.sleep_text ? r.sleep_text.replace(/^(\d+):(\d+)$/, function (m, a, b) { return (+a) + "h " + (+b) + "m"; }) : null;
    var rings = [
      r.strain != null ? ring(api, ".v-wh-strain", r.strain / 21, r.strain.toFixed(1), "of 21", "Prev day strain") : null,
      ring(api, ".v-wh-rec.v-wh-" + zone, r.recovery_pct / 100, r.recovery_pct + "%", null, "Recovery"),
      r.sleep_performance != null ? ring(api, ".v-wh-sleep", r.sleep_performance / 100, r.sleep_performance + "%", sleepWords, "Sleep")
        : sleepWords ? ring(api, ".v-wh-sleep", 0, sleepWords, null, "Sleep") : null];
    var stats = [[r.hrv, "HRV ms"], [r.rhr, "Rest HR"], [r.avg_hr, "Avg HR"],
      [r.sleep_consistency != null ? r.sleep_consistency + "%" : null, "Sleep consistency"]]
      .filter(function (x) { return x[0] != null; })
      .map(function (x) { return api.h("div.v-wh-stat", null, api.h("div.v-wh-sn.v-num", null, String(x[0])), api.h("div.v-wh-sl", null, x[1])); });
    var st = r.stages_min || {}, tot = (st.light || 0) + (st.sws || 0) + (st.rem || 0);
    var stages = tot ? api.h("div.v-wh-stages", null,
      api.h("div.v-wh-stk", null, "Sleep stages"),
      api.h("div.v-wh-bar", { role: "img", "aria-label": "Light, then SWS, then REM" }, [["light", "Light"], ["sws", "SWS"], ["rem", "REM"]].map(function (x) {
        return api.h("div.v-wh-seg.v-wh-" + x[0], { style: "width:" + ((st[x[0]] || 0) / tot * 100).toFixed(1) + "%" });
      })),
      api.h("div.v-kv", null,
        kvRow(api, "Light", minText(st.light || 0)), kvRow(api, "SWS", minText(st.sws || 0)), kvRow(api, "REM", minText(st.rem || 0)),
        r.sleep_need_h != null ? kvRow(api, "Need", hmText(r.sleep_need_h)) : null,
        r.sleep_debt_h != null ? kvRow(api, "Debt", hmText(r.sleep_debt_h)) : null)) : null;
    var day = r.date ? api.fmtDayOnly(r.date) : null;
    return api.h("section.v-card.v-wh", null,
      api.h("div.v-card-head", null, api.h("h2.v-label", null, r.source || "Recovery"), day ? api.h("span.v-card-meta", null, day) : null),
      api.h("div.v-wh-rings", null, rings),
      stats.length ? api.h("div.v-wh-stats", null, stats) : null,
      stages);
  }

  /* ---------- Inbox card: Open goes to the Gmail app ---------- */
  var GMAIL_APP = "googlegmail://", GMAIL_WEB = "https://mail.google.com/";
  // The Gmail app when it is installed; the web inbox when the app did not open.
  function openGmail() {
    var left = false, mark = function () { if (document.visibilityState === "hidden") left = true; };
    try { document.addEventListener("visibilitychange", mark); } catch (e) { /* none */ }
    setTimeout(function () {
      try { document.removeEventListener("visibilitychange", mark); } catch (e) { /* none */ }
      if (!left && document.visibilityState === "visible") window.location.href = GMAIL_WEB;
    }, 1500);
    window.location.href = GMAIL_APP;
  }

  /* ---------- Today ---------- */
  function heading(api, title, sub) {
    return api.h("div.v-head", null, api.h("h1.v-h1", null, title), sub ? api.h("div.v-h1-sub", null, sub) : null);
  }
  function renderToday(s, api) {
    // Phone order: Needs you bar, conflicts, weather, tiles, the day, tasks, mail, watching,
    // goals, recovery. The system lives on the OttoOS tab only; the week ahead is left out.
    var colA = api.h("div.v-col.v-col-a", null, ord(1, conflictsCard(api, s)), ord(2, weatherCard(api, s)), ord(3, glance(api, s)), ord(4, timeline(api, s)));
    var colB = api.h("div.v-col.v-col-b", null, ord(5, dueCard(api, s)), ord(6, inboxCard(api, s)),
      ord(7, listCard(api, "Watching", s.watching)), ord(8, listCard(api, "Goals", s.goals)));
    var colC = api.h("div.v-col.v-col-c", null, ord(9, whoopCard(api, s)));
    return [heading(api, api.fmtDay(new Date()), "Otto checked " + api.fmtTime(s.generated)), needsBar(api),
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
      : api.preview(it) ? api.h("div.v-lineprev", null, api.preview(it)) : null;
    return api.h("article.v-card.v-needfull", null,
      api.h("div.v-need-meta", null, api.h("span.v-tag", null, api.typeLabel(it)), it.area ? api.h("span.v-tag", null, it.area) : null,
        it.decide_today ? status(api, "wait", "Decide today") : null),
      api.h("div.v-need-title.v-big", null, it.title),
      api.h("div.v-need-why", null, api.whyText(it.why)),
      prev,
      reviewBlock(api, it),
      api.h("div.v-need-by", null, "From " + api.nameOf(it.agent) + ", " + api.ago(it.created)),
      reason ? api.h("div.v-need-why", null, reason) : null,
      done || buttons(api, it));
  }
  // A content review (golf reading watcher): one line per field, then its sources.
  function reviewBlock(api, it) {
    var lines = Array.isArray(it.review) ? it.review : [], srcs = Array.isArray(it.sources) ? it.sources : [];
    if (!lines.length && !srcs.length) return null;
    return api.h("div.v-review", null,
      lines.map(function (l) { return api.h("div.v-review-line", null, String(l)); }),
      srcs.length ? api.h("div.v-review-src", null, srcs.map(function (lk) {
        return /^https:\/\//.test(lk.url || "") ? api.h("a.v-link", { href: lk.url, target: "_blank", rel: "noopener" }, lk.label || "Link") : null;
      })) : null);
  }
  function renderInbox(s, api) {
    var needs = openNeeds(api), filed = filedList(api, s), b = on(s.inbox) ? s.inbox : {}, ik = b.mail_counts || {};
    var dg = b.digest || [], cards = [], fn = filedCount(s, filed);
    if (needs.length) cards.push(api.h("div.v-sub-head.v-sub-first", null, status(api, "wait", "Needs you " + needs.length)),
      needs.map(function (it) { return needFull(api, it); }));
    if (on(s.inbox)) {
      var did = fn || dg.length || needs.length;
      var lines = statLines(api, [
        [ik.read != null ? ik.read : null, "Read today, new and older"],
        [sortedTotal(b) || null, "Receipts and bills sorted"],
        [ik.waiting || null, "Waiting to be read"]]);
      cards.push(card(api, "Otto's mail today", null, [
        !did && ik.read != null ? api.h("div.v-sys-head", null, status(api, "live", "Otto read " + api.plural(ik.read, "email") + " today, nothing needed you")) : null,
        lines,
        filed.length ? [api.h("div.v-sub-head", null, FILED_WORDS + " " + fn), filed.map(function (r) { return filedRow(api, r); })] : null,
        dg.length ? [api.h("div.v-sub-head", null, DIGEST_WORDS + " " + dg.length), dg.map(function (r) { return digestRow(api, r); })] : null
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
    return [heading(api, "Inbox", null), dayStrip(api, s), api.h("div.v-stack", null, cards)];
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
      api.h("div.v-stack.v-lists", null, groups.length ? groups : muted(api, "Nothing open"), clin)];
  }

  /* ---------- Otto ---------- */
  function renderOtto(s, api) {
    var pf = on(s.platform) ? s.platform : {}, a = agentRows(s), vm = s.vm, c = on(s.decisions) ? (s.decisions.verdicts || []) : [];
    // The "Otto and system" card left Today (2026-10-20); its schedule line lives here.
    var liveN = a.filter(function (x) { return x.state === "live"; }).length;
    var schedN = a.filter(function (x) { return x.state !== "manual"; }).length;
    var stale = a.some(function (x) { return unchecked(api, s, x); });
    var statusCard = card(api, "Status", null, [
      sysHead(api, s),
      api.h("div.v-kv", null,
        schedN ? kvRow(api, stale ? "On schedule at " + api.fmtTime(s.generated) : "Agents on schedule", liveN + " of " + schedN) : null,
        kvRow(api, "Last check", api.fmtTime(s.generated)),
        nextCheckRow(api, s),
        pf.self_update ? kvRow(api, "Updated", whenLabel(api, pf.self_update)) : null)
    ]);
    var agents = a.length ? card(api, "Agents", api.h("span.v-card-meta", null, a.length + " on the roster"),
      a.map(function (x) { return agentRow(api, s, x, false); })) : null;
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
        api.h("div.v-filed-main", null, api.h("div.v-act-title", null, words(e.summary || api.OPS[e.action] || e.action)), api.h("div.v-ev-sub", null, api.nameOf(e.agent))),
        bad ? status(api, "wait", "Failed") : status(api, "live", "Done"));
    }) : muted(api, "No activity yet"));
    var decisions = c.length ? card(api, "Decisions on record", null, c.map(function (v) {
      return api.h("div.v-verdict", null, api.h("div.v-ev-sub", null, v.date), api.h("div.v-ev-title", null, v.title), v.line ? api.h("div.v-ev-sub", null, v.line) : null);
    })) : null;
    var net = window.OttoNetwork && window.OttoNetwork.renderMap;
    var mapCard = card(api, "Team map and gates", link(api, ui.map ? "Hide" : "Show", function () { ui.map = !ui.map; api.render(); }),
      ui.map && net ? api.h("div.v-map", null, net(s, api)) : muted(api, api.plural((s.gates || []).length, "gate") + ", map hidden"));
    return [heading(api, "Otto", null), window.OttoAsk ? window.OttoAsk.card(s, api) : null, dayStrip(api, s),
      api.h("div.v-grid.v-grid-otto", null,
        api.h("div.v-col", null, ord(1, statusCard), ord(3, vmCard), ord(5, decisions),
          ord(6, listCard(api, "Watching", s.watching)), ord(7, listCard(api, "Goals", s.goals))),
        api.h("div.v-col", null, ord(2, agents)),
        api.h("div.v-col", null, ord(4, act), ord(8, mapCard), ord(10, api.lookPicker())))];
  }

  /* ---------- chrome: wordmark, text tabs, toast ---------- */
  function renderTop(s, api) {
    var n = s ? openNeeds(api).length : 0, probs = problems(api, s);
    return [
      api.h("div.v-brand", null,
        api.h("span.v-word", null, api.h("span.v-word-a", null, "Otto"), api.h("span.v-word-b", null, "OS"))),
      api.h("div.v-top-right", null,
        n ? api.h("button.v-pill", { type: "button", on: { click: function () { api.go("needs"); } } }, api.h("span.v-num", null, n + " need you"))
          : probs.length ? api.h("button.v-pill", { type: "button", on: { click: function () { api.go("otto"); } } }, api.h("span.v-num", null, api.plural(probs.length, "problem")))
          : status(api, "live", "Clear"),
        api.DEMO ? api.h("span.v-demo", null, "Demo") : null)
    ];
  }
  function renderTabs(s, api) {
    var n = s ? openNeeds(api).length : 0, cur = api.tab();
    return api.tabs().filter(function (t) { return !t.hidden; }).map(function (t) {
      var sel = cur === t.id;
      return api.h("button.v-tab" + (sel ? ".v-on" : ""), { type: "button", "aria-current": sel ? "page" : null,
        on: { click: function () { api.go(t.id); } } },
        api.h("span.v-tab-l", null, t.short),
        t.id === "inbox" && n ? api.h("span.v-badge.v-num", null, String(n)) : null);
    });
  }
  function renderToast(t, api) {
    return [api.h("span.v-toast-text", null, api.h("span", null, t.text)),
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
      { id: "otto", short: "OttoOS", title: "OttoOS", fn: "renderOtto" },
      // no tab of its own: the Needs you bar and the top pill open it
      { id: "needs", short: "Needs you", title: "Needs you", fn: "renderNeeds", hidden: true }
    ],
    alias: { activity: "otto", system: "otto", working: "otto", built: "otto" },
    renderToday: renderToday,
    renderNeeds: renderNeeds,
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
