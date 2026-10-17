/* Otto Home look: Combined, the production look (picked 2026-10-17).
   Four tabs: Home (stat tiles, decisions, Otto handled, a compact Sleep card at the bottom),
   Lists (Google Tasks by list), Activity, and System as the team map (themes/network.js,
   loaded ahead of this file via "needs" in themes/list.js). Every field may be missing.
   Rendering only: every tap goes through api.send / api.tap; no fetch, no storage. */
(function () {
  "use strict";
  if (!window.OttoHome) return;

  var RESULT = {
    ok: { shape: "r-ok", word: "Done" },
    skipped: { shape: "r-skip", word: "Skipped" },
    would: { shape: "r-dry", word: "Dry run" },
    failed: { shape: "r-fail", word: "Failed" },
    error: { shape: "r-fail", word: "Failed" },
    refused: { shape: "r-fail", word: "Refused" }
  };

  function sh(api, cls) { return api.h("span.c-shape." + cls, { "aria-hidden": "true" }); }
  function item(api, cls, word) { return api.h("span.c-key", null, sh(api, cls), word); }
  function keyRow(api, pairs) { return api.h("div.c-legend", { "aria-label": "Legend" }, pairs.map(function (p) { return item(api, p[0], p[1]); })); }
  function label(api, text, extra) { return api.h("div.c-label", null, api.h("span", null, text), extra || null); }

  /* ---------- Today ---------- */
  function tiles(api, s) {
    var open = api.openItems().length, mins = api.minutesToClear(open);
    function tile(n, word) { return api.h("div.c-tile", null, api.h("div.c-tile-n", null, n), api.h("div.c-tile-l", null, word)); }
    return api.h("div.c-tiles", null,
      tile(String(open), "Need you"),
      tile(String(api.doneToday(s)), "Done today"),
      tile(open ? mins + " min" : "0", "To clear"));
  }
  function healthRow(api, s) {
    var p = api.health(s);
    if (!p.length) return api.h("div.c-health", null, sh(api, "ok"), api.h("span", null, "All systems normal"));
    return api.h("div.c-health.warn", null, sh(api, "problem"),
      api.h("span", null, p.length === 1 ? "1 problem: " + p[0].short : p.length + " problems, see System"));
  }
  function eventPreview(api, it) {
    var c = api.calPreview(it), e = it.effect || {};
    var bar = e.op === "rsvp" ? "RSVP " + (c.response || "yes") : c.calendar ? "Add to " + c.calendar + " Calendar" : "New event";
    return api.h("div.c-event", null,
      api.h("div.c-event-bar", null, bar),
      api.h("div.c-event-body", null,
        api.h("div.c-event-date", null, api.h("div.c-event-day", null, c.day), api.h("div.c-event-num", null, c.num), api.h("div.c-event-mon", null, c.month)),
        api.h("div.c-event-info", null,
          api.h("div.c-event-title", null, c.title),
          c.time ? api.h("div.c-event-time", null, c.time) : null,
          c.place ? api.h("div.c-event-place", null, c.place) : null)));
  }
  function replyPreview(api, it) {
    var r = api.replyPreview(it);
    return api.h("div.c-reply", null,
      r.to ? api.h("div.c-reply-meta", null, "To " + r.to) : null,
      r.subject ? api.h("div.c-reply-meta", null, r.subject) : null,
      api.h("div.c-reply-text", null, r.text));
  }
  function linePreview(api, it) { return api.h("div.c-line-preview", null, api.preview(it)); }

  function decision(api, it) {
    var r = api.sent(it.id);
    if (r && r.ok !== false) {
      return api.h("div.c-card.c-done", { "data-id": it.id }, sh(api, "check"),
        api.h("div", null, api.h("div.c-done-word", null, (api.DONE_WORD[r.action] || "Sent") + ": " + it.title),
          api.h("div.c-meta", null, cap(api.applyPhrase(r.at)))));
    }
    var kind = api.previewKind(it), why = api.whyText(it.why), reason = r && r.ok === false ? "Not sent: " + r.err : api.reason(it.id);
    var tag = [api.areaOf(it), api.typeLabel(it)].filter(Boolean).join(" - ");
    var acts = (it.actions && it.actions.length ? it.actions : ["approve", "deny", "snooze"]);
    function btn(a, cls, word) {
      if (acts.indexOf(a) < 0) return null;
      return api.h("button.c-btn." + cls, { type: "button", on: { click: function () { api.send(it.id, a, api.tokenFor(it, a)); } } }, word);
    }
    return api.h("article.c-card.c-decide", { "data-id": it.id },
      api.h("div.c-tagrow", null,
        it.decide_today ? api.h("span.c-due", null, sh(api, "due"), "Due today") : null,
        tag ? api.h("span.c-tag", null, tag) : null),
      api.h("h2.c-q", null, it.title),
      kind === "event" ? eventPreview(api, it) : kind === "reply" ? replyPreview(api, it) : linePreview(api, it),
      why ? api.h("div.c-why", null, "Why: " + why) : null,
      reason ? api.h("div.c-reason", null, sh(api, "problem"), reason) : null,
      api.h("div.c-actions", null, btn("approve", "primary", "Approve"), btn("deny", "outline", "Deny"), btn("snooze", "text", "Later")));
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

  function handledRow(api, it) {
    var r = api.sent(it.id);
    if (r && r.ok !== false) {
      return api.h("li.c-row", null, sh(api, "undone"), api.h("div.c-row-main", null,
        api.h("div.c-row-title", null, (api.DONE_WORD[r.action] || "Sent") + ": " + it.title),
        api.h("div.c-meta", null, cap(api.applyPhrase(r.at)))));
    }
    return api.h("li.c-row", null, sh(api, "check"),
      api.h("div.c-row-main", null, api.h("div.c-row-title", null, it.title), api.h("div.c-meta", null, api.fmtTime(it.at))),
      api.undoable(it) ? api.h("button.c-link", { type: "button", on: { click: function () { api.send(it.id, "undo", it.undo_token); } } }, "Undo") : null);
  }

  function renderToday(s, api) {
    var items = api.pendingItems().slice().sort(function (a, b) {
      return (b.decide_today ? 1 : 0) - (a.decide_today ? 1 : 0) || (a.priority || 9) - (b.priority || 9);
    });
    var done = api.handled(s), ui = api.ui, shown = ui.addedAll ? done : done.slice(0, 4);
    return [
      tiles(api, s),
      healthRow(api, s),
      label(api, items.length ? "Decide" : "Nothing to decide"),
      items.map(function (it) { return decision(api, it); }),
      label(api, "Otto handled"),
      done.length
        ? api.h("div.c-card.c-list", null, api.h("ul.c-rows", null, shown.map(function (it) { return handledRow(api, it); })),
          done.length > 4 ? api.h("button.c-link.c-more", { type: "button", on: { click: function () { ui.addedAll = !ui.addedAll; api.render(); } } },
            ui.addedAll ? "Show fewer" : "Show " + (done.length - 4) + " more") : null)
        : api.h("div.c-card.c-empty", null, "Nothing handled yet"),
      keyRow(api, [["due", "Due today"], ["check", "Done by Otto"], ["ok", "Normal"], ["problem", "Problem"]]),
      sleepCard(api, s)
    ];
  }

  /* ---------- Life ---------- */
  // Bars for a 7-day series. A null value is a day with no data: an empty column.
  // With a goal: Met goal = filled bar, Under goal = outlined bar, dashed goal line.
  function bars(api, values, opts) {
    var nums = values.filter(function (v) { return typeof v === "number" && isFinite(v); });
    var max = Math.max.apply(null, nums.concat([opts.goal || 0, 0])) * 1.12 || 1, days = api.lastDays(values.length);
    return api.h("div.c-bars", { role: "img", "aria-label": opts.aria },
      opts.goal ? api.h("div.c-goal", { style: "bottom:" + (opts.goal / max * 100).toFixed(1) + "%" }, api.h("span", null, "Goal " + opts.goal + " " + opts.unit)) : null,
      values.map(function (v, i) {
        var has = typeof v === "number" && isFinite(v);
        var met = !opts.goal || (opts.lowerIsBetter ? v <= opts.goal : v >= opts.goal);
        return api.h("div.c-bar-col", null,
          api.h("div.c-bar-v", null, has ? String(v) : "-"),
          has ? api.h("div.c-bar" + (met ? ".met" : ".under"), { style: "height:" + (v / max * 100).toFixed(1) + "%" }) : api.h("div.c-bar-none"),
          api.h("div.c-bar-d", null, days[i]));
      }));
  }
  // Home's compact Sleep card. No sleep data: no card at all.
  function sleepCard(api, s) {
    var hz = api.series(s).sleep;
    if (!hz || hz.connected === false) return null;
    var vals = (hz.last_7d || []).filter(function (x) { return typeof x === "number" && isFinite(x); });
    if (!vals.length) return null;
    var unit = hz.unit || "h", goal = typeof hz.goal === "number" && hz.goal > 0 ? hz.goal : null;
    var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var met = goal ? vals.filter(function (x) { return x >= goal; }).length : 0;
    return [label(api, hz.metric || "Sleep"), api.h("section.c-card.c-health-card.c-compact", null,
      api.h("div.c-big-line", null, avg.toFixed(1) + " " + unit + " average"),
      api.h("div.c-meta", null, goal ? "Goal " + goal + " " + unit + ", met " + met + " of " + vals.length + " nights" : "No sleep goal on file"),
      bars(api, hz.last_7d, { goal: goal, unit: unit, aria: goal ? "Sleep, last 7 nights, against the goal" : "Sleep, last 7 nights" }),
      goal ? keyRow(api, [["bar-met", "Met goal"], ["bar-under", "Under goal"], ["goal", "Goal " + goal + " " + unit]])
        : keyRow(api, [["bar-met", "Hours slept"]]))];
  }
  /* ---------- Lists ---------- */
  function listCard(api, l) {
    var items = l.items || [], n = +l.count || 0, c = +l.clinical || 0, open = (api.ui.listOpen || {})[l.key];
    var head = api.h("div.c-card-head", null, api.h("h2.c-card-title", null, l.name), api.h("span.c-count-pill", null, String(n)));
    if (!n && !c) {
      return api.h("section.c-card.c-list-empty", null, api.h("div.c-row-title", null, l.name),
        api.h("span.c-meta", null, l.error ? "Not read" : "Nothing open"));
    }
    return api.h("section.c-card.c-tasklist", null, head,
      items.length ? api.h("ul.c-rows.tight", null, api.listShown(l).map(function (x) {
        return api.h("li.c-row", null,
          api.h("div.c-row-main", null, api.h("div.c-row-title", null, x.title),
            x.due_text ? api.h("div.c-meta", null, "Due " + x.due_text) : null),
          x.otto ? api.h("span.c-otto", null, "Otto") : null,
          x.undo_item && x.undo_token ? api.h("button.c-link", { type: "button", on: { click: function () { api.send(x.undo_item, "undo", x.undo_token); } } }, "Undo") : null);
      })) : null,
      items.length > api.LIST_SHOW ? api.h("button.c-link.c-more", { type: "button", on: { click: function () { api.listToggle(l.key); } } },
        open ? "Show fewer" : "Show " + (items.length - api.LIST_SHOW) + " more") : null,
      n > items.length ? api.h("div.c-meta", null, (n - items.length) + " more in Google Tasks") : null,
      c ? api.h("div.c-meta.c-clin", null, api.plural(c, "clinical task")) : null);
  }
  function renderLists(s, api) {
    var tl = api.taskLists(s);
    if (!tl.connected) return [api.h("div.c-card.c-empty", null, "Tasks not connected")];
    var total = 0;
    tl.lists.forEach(function (l) { total += (+l.count || 0) + (+l.clinical || 0); });
    return [label(api, api.plural(total, "open task")), tl.lists.map(function (l) { return listCard(api, l); })];
  }

  /* ---------- Activity ---------- */
  function renderActivity(s, api) {
    var rows = (s.timeline || []).slice().sort(function (a, b) { return (api.d(b.ts) || 0) - (api.d(a.ts) || 0); });
    var out = [keyRow(api, [["r-ok", "Done"], ["r-dry", "Dry run"], ["r-skip", "Skipped"], ["r-fail", "Failed"]])], last = null, list = null;
    if (!rows.length) out.push(api.h("div.c-card.c-empty", null, "No activity yet"));
    rows.forEach(function (e) {
      var k = api.dayKey(e.ts);
      if (k !== last) { out.push(label(api, api.fmtDay(e.ts))); list = api.h("ul.c-card.c-list.c-rows.c-timeline"); out.push(list); last = k; }
      var r = RESULT[e.result] || { shape: "r-other", word: cap(e.result || "Logged") };
      api.add(list, api.h("li.c-row", null,
        api.h("div.c-time", null, api.fmtTime(e.ts)),
        api.h("div.c-row-main", null,
          api.h("div.c-row-title", null, e.summary || api.OPS[e.action] || e.action || ""),
          api.h("div.c-meta", null, [cap(e.source), api.nameOf(e.agent)].filter(Boolean).join(" - "))),
        api.h("span.c-result", null, sh(api, r.shape), r.word)));
    });
    return out;
  }

  /* ---------- System ---------- */
  function gatesCard(api, s) {
    var g = s.gates || [];
    return [label(api, "Gates, read only"),
      g.length ? api.h("div.c-card.c-list", null, api.h("ul.c-rows", null, g.map(function (x) {
        return api.h("li.c-row", null, api.h("div.c-row-main", null, api.h("div.c-row-title.c-mono", null, x.name)), api.st(x.state));
      }))) : api.h("div.c-card.c-empty", null, "No gates reported")];
  }
  function clearCard(api, s) {
    var ser = api.series(s), w = s.working || {}, ttc = ser.timeToClear;
    var nums = (ttc || []).filter(function (x) { return typeof x === "number"; });
    var avg = w.time_to_clear_7d_min != null ? w.time_to_clear_7d_min : nums.length ? nums[nums.length - 1] : null;
    if (avg == null && !nums.length) return null;
    return [label(api, "Time to clear, last 7 days"), api.h("section.c-card", null,
      api.h("div.c-big-line", null, avg + " min average"),
      api.h("div.c-meta", null, "Minutes from first open to nothing left"),
      nums.length ? bars(api, ttc, { unit: "min", aria: "Minutes to clear each day, last 7 days" }) : null)];
  }
  function builtCards(api, s) {
    var ser = api.series(s), org = s.org || {};
    return [
      api.h("div.c-legend-wrap", null, api.legend(api.stateIds(s).concat(ser.teamsNow.length ? ["running"] : []))),
      (org.departments || []).map(function (dp) {
        return api.h("section.c-card.c-dept", null,
          api.h("div.c-card-head", null, api.h("h2.c-card-title", null, dp.name)),
          api.h("div.c-owner", null, api.h("span", null, "Lead: " + (dp.lead_name || api.nameOf(dp.lead))), api.st(dp.lead_state)),
          (dp.members || []).length ? api.h("ul.c-rows.tight.c-members", null, dp.members.map(function (m) {
            return api.h("li.c-row", null, api.h("div.c-row-main", null, api.h("div.c-row-title", null, m.name || api.nameOf(m.id))), api.st(m.state));
          })) : null);
      })];
  }
  function listSystem(api, s) {
    var ser = api.series(s);
    return [
      label(api, "Working now"),
      api.h("div.c-card.c-list", null, ser.teamsNow.length ? api.h("ul.c-rows", null, ser.teamsNow.map(function (t) {
        return api.h("li.c-row", null, api.h("div.c-row-main", null, api.h("div.c-row-title", null, t.name || api.nameOf(t.id)), api.h("div.c-meta", null, t.task || "")), api.st("running"));
      })) : api.h("div.c-empty", null, "Nobody running right now")),
      ser.teamToday && ser.teamToday.length ? [label(api, "Today by team"), api.h("div.c-card.c-list", null, api.h("ul.c-rows", null, ser.teamToday.map(function (t) {
        return api.h("li.c-row", null, api.h("div.c-count", null, String(t.count)), api.h("div.c-row-main", null, api.h("div.c-row-title", null, t.name || api.nameOf(t.id)), api.h("div.c-meta", null, t.what || "")));
      })))] : null];
  }
  function renderSystem(s, api) {
    var p = api.health(s), next = api.nextCheck(s), ui = api.ui;
    var net = window.OttoNetwork && window.OttoNetwork.renderMap ? window.OttoNetwork.renderMap(s, api) : null;
    var top = api.h("section.c-card", null,
      p.length ? api.h("div.c-health.warn.big", null, sh(api, "problem"), api.plural(p.length, "problem"))
        : api.h("div.c-health.big", null, sh(api, "ok"), "All systems normal"),
      p.map(function (x) { return api.h("div.c-problem", null, api.h("div.c-row-title", null, x.short), x.detail ? api.h("div.c-meta", null, x.detail) : null); }),
      api.h("div.c-meta.c-gap", null, "Updated " + (api.agoWords(s.generated) || "never") + (next ? ", next check about " + api.fmtTime(next) : "")));
    if (!net) {
      // No map module (another look borrowing this file): the plain list.
      return [top, listSystem(api, s), clearCard(api, s), label(api, "Everything built"), builtCards(api, s), gatesCard(api, s), api.lookPicker()];
    }
    return [
      top,
      label(api, "Teams"),
      net,
      clearCard(api, s),
      gatesCard(api, s),
      api.h("button.c-link.c-more.c-details", { type: "button", "aria-expanded": ui.sysDetails ? "true" : "false",
        on: { click: function () { ui.sysDetails = !ui.sysDetails; api.render(); } } },
        ui.sysDetails ? "Hide details" : "Details: everything built"),
      ui.sysDetails ? builtCards(api, s) : null,
      api.lookPicker()
    ];
  }

  function renderToast(t, api) {
    return [api.h("span.toast-text", null, sh(api, "check"), api.h("span", null, t.text)),
      api.h("button.toast-undo", { type: "button", on: { click: t.onUndo } }, "Undo")];
  }

  function renderTop(s, api) {
    var tab = api.tab(), title = (api.TABS.filter(function (x) { return x.id === tab; })[0] || {}).title || "";
    var sub = tab === "today" && s ? api.fmtDay(new Date()) : null;
    var f = api.freshness(), meta = api.DEMO ? "Demo" : f.text;
    return [api.h("div.c-top-main", null, api.h("div.c-top-title", null, title),
      api.h("div.c-top-sub", null, [sub, meta].filter(Boolean).join(" - "))),
      api.h("button.c-refresh", { type: "button", on: { click: function () { api.refresh(); } } }, "Refresh")];
  }

  window.OttoHome.register("combined", {
    label: "Combined",
    standalone: true,
    themeColor: "#111214",
    renderToday: renderToday,
    renderLists: renderLists,
    renderActivity: renderActivity,
    renderSystem: renderSystem,
    renderToast: renderToast,
    renderTop: renderTop
  });
})();
