/* Otto Home System map (the production System tab, used by themes/combined.js).
   Otto in the center, the teams from the snapshot around it, linked by lines. Teams working
   right now get a dashed light blue link. Tap a team for what it did today.
   Names, order and counts all come from the snapshot (working.network.teams, else
   org.departments); this file names no team. Rendering only: no fetch, no storage, no
   writes. SVG is built with createElementNS and textContent, never innerHTML of data. */
(function () {
  "use strict";
  if (!window.OttoHome) return;

  /* ---------- SVG helper ---------- */
  var NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, kids) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") el.textContent = String(v);
      else if (k === "on") Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
      else el.setAttribute(k, String(v));
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  /* ---------- teams ---------- */
  // Live snapshots carry working.network.teams in org-chart order (per-team counts and
  // working-now). Older snapshots may not: fall back to org.departments with no counts.
  function teams(s, api) {
    var w = s.working || {}, net = (w.network || {}).teams;
    if (net && net.length) return net.slice(0, SPOTS.length);
    var now = {};
    api.series(s).teamsNow.forEach(function (t) { now[t.id] = t.task || ""; });
    var out = [];
    ((s.org || {}).departments || []).forEach(function (dp) {
      var ids = [dp.lead].concat((dp.members || []).map(function (m) { return m.id; }));
      function working(list) { return list.filter(function (i) { return Object.prototype.hasOwnProperty.call(now, i); })[0]; }
      if (dp.lead === "otto") {
        (dp.members || []).forEach(function (m) {
          var hit = working([m.id]);
          out.push({ id: m.id, name: m.name || api.nameOf(m.id), dept: dp.name, state: m.state,
            working_now: hit != null, task: hit != null ? now[hit] : null, did: null, counts: null });
        });
        return;
      }
      var hit = working(ids);
      out.push({ id: dp.lead, name: dp.lead_name || api.nameOf(dp.lead), dept: dp.name, state: dp.lead_state,
        working_now: hit != null, task: hit != null ? now[hit] : null, did: null, counts: null });
    });
    return out.slice(0, SPOTS.length);
  }
  function stateOf(t) { return t.working_now ? "running" : (t.state || "unknown"); }

  // Fixed spots for up to 12 teams around Otto, sized for a 358 px wide map (390 phone).
  var W = 358, H = 560, CX = 179, CY = 258, R = 58;
  var SPOTS = [
    [179, 34],
    [66, 112], [52, 192], [48, 272], [52, 352], [66, 432],
    [292, 112], [306, 192], [310, 272], [306, 352], [292, 432],
    [179, 488]
  ];

  function nodeShape(state, x, y, on) {
    var cls = "n-node-shape s-" + state;
    if (state === "dormant") return svg("rect", { x: x - 11, y: y - 11, width: 22, height: 22, rx: 2, "class": cls });
    if (state === "running") return svg("rect", { x: x - 10, y: y - 10, width: 20, height: 20, "class": cls, transform: "rotate(45 " + x + " " + y + ")" });
    if (state === "retired") return svg("rect", { x: x - 12, y: y - 2, width: 24, height: 4, "class": cls });
    if (state === "unknown") return svg("rect", { x: x - 10, y: y - 10, width: 20, height: 20, "class": cls });
    return svg("circle", { cx: x, cy: y, r: on ? 13 : 12, "class": cls });
  }

  function map(s, api, list) {
    var sel = api.ui.netSel || null, open = api.openItems().length;
    var lines = [], nodes = [];
    list.forEach(function (t, i) {
      var p = SPOTS[i]; if (!p) return;
      var dx = p[0] - CX, dy = p[1] - CY, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var x1 = CX + dx / len * (R + 4), y1 = CY + dy / len * (R + 4);
      var x2 = p[0] - dx / len * 18, y2 = p[1] - dy / len * 18;
      lines.push(svg("line", { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1),
        "class": "n-link" + (t.working_now ? " n-working" : "") + (sel === t.id ? " n-link-on" : "") }));
      var state = stateOf(t), on = sel === t.id, word = api.STATES[state] || api.cap(state);
      if (state === "running") word = "Working";
      function pick() {
        api.ui.netSel = on ? null : t.id;
        api.render();
        setTimeout(function () {
          var c = document.querySelector(".n-card");
          if (c && c.scrollIntoView) c.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 0);
      }
      nodes.push(svg("g", {
        "class": "n-node" + (on ? " on" : ""), role: "button", tabindex: "0",
        "aria-label": t.name + ", " + (t.dept || "") + ", " + word + (on ? ", selected" : ""),
        "aria-pressed": on ? "true" : "false",
        on: { click: pick, keydown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } } }
      }, [
        svg("circle", { cx: p[0], cy: p[1] + 18, r: 34, "class": "n-hit" }),
        on ? svg("circle", { cx: p[0], cy: p[1], r: 20, "class": "n-ring" }) : null,
        nodeShape(state, p[0], p[1], on),
        svg("text", { x: p[0], y: p[1] + 36, "class": "n-name", "text-anchor": "middle", text: t.name }),
        svg("text", { x: p[0], y: p[1] + 57, "class": "n-word", "text-anchor": "middle", text: word })
      ]));
    });
    var center = svg("g", { "class": "n-otto", role: "button", tabindex: "0",
      "aria-label": "Otto, " + open + " for you, open Today",
      on: {
        click: function () { api.go("today"); },
        keydown: function (e) { if (e.key === "Enter") api.go("today"); }
      } }, [
      svg("circle", { cx: CX, cy: CY, r: R, "class": "n-otto-dot" }),
      svg("text", { x: CX, y: CY - 6, "class": "n-otto-name", "text-anchor": "middle", text: "Otto" }),
      svg("text", { x: CX, y: CY + 20, "class": "n-otto-count", "text-anchor": "middle", text: open ? open + " for you" : "All clear" })
    ]);
    return api.h("div.n-map-wrap", null, svg("svg", {
      viewBox: "0 0 " + W + " " + H, "class": "n-map", role: "group",
      "aria-label": "Otto and its teams. Tap a team for its day."
    }, [svg("g", {}, lines), center, svg("g", {}, nodes)]));
  }

  function card(api, t) {
    if (!t) return api.h("div.n-hint", null, "Tap a team to see what it did today");
    var state = stateOf(t);
    return api.h("section.n-card", { "aria-label": t.name + " today" },
      api.h("div.n-card-head", null,
        api.h("div", null, api.h("h2.n-card-title", null, t.name), t.dept ? api.h("div.n-card-dept", null, t.dept) : null),
        api.h("button.n-close", { type: "button", on: { click: function () { api.ui.netSel = null; api.render(); } } }, "Close")),
      api.h("div.n-card-state", null, api.st(state, state === "running" ? "Working now" : null)),
      t.working_now && t.task ? api.h("div.n-now", null, "Now: " + t.task) : null,
      api.h("div.n-did", null, t.did || "No report for today yet"),
      t.counts && t.counts.length ? api.h("div.n-counts", null, t.counts.slice(0, 3).map(function (c) {
        return api.h("div.n-count", null, api.h("div.n-count-n", null, String(c.n)), api.h("div.n-count-l", null, c.label));
      })) : null);
  }

  function linkKey(api, cls, word) {
    return api.h("span.n-key", null, svg("svg", { width: 28, height: 10, viewBox: "0 0 28 10", "aria-hidden": "true" },
      [svg("line", { x1: 1, y1: 5, x2: 27, y2: 5, "class": "n-link " + cls })]), word);
  }

  // The map block: legend, map and the selected team's card. The System tab around it
  // (health, freshness, gates) is built by themes/combined.js.
  function renderMap(s, api) {
    var list = teams(s, api);
    if (!list.length) return null;
    var sel = null;
    list.forEach(function (t) { if (t.id === api.ui.netSel) sel = t; });
    var used = list.map(stateOf), order = ["live", "dark", "dormant", "retired", "running", "unknown"];
    return [
      api.h("div.n-legend", { "aria-label": "Legend" },
        api.h("div.legend", null, order.filter(function (x) { return used.indexOf(x) >= 0; })
          .concat(used.filter(function (x) { return order.indexOf(x) < 0; }).filter(function (x, i, a) { return a.indexOf(x) === i; }))
          .map(function (x) { return api.st(x, x === "running" ? "Working" : null); })),
        api.h("div.n-legend-lines", null, linkKey(api, "", "Linked"), linkKey(api, "n-working", "Working now"))),
      map(s, api, list),
      card(api, sel)
    ];
  }

  window.OttoNetwork = { renderMap: renderMap, teams: teams };
})();
