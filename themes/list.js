/* Otto Home looks. One line per theme; the first entry is the default and the only look
   production loads (approved 2026-10-17: OttoOS v3, with the network map on the Otto tab).
   Each id needs themes/<id>.css and themes/<id>.js (which calls OttoHome.register).
   "needs" lists helper modules (themes/<name>.css + .js) loaded before the theme's own js.
   The other looks are demo only (?demo=1 Look picker) and are not deployed.
   "classic" (the original light look) is built into app.js and always listed first in the picker. */
window.OTTO_THEMES = [
  { id: "v3", label: "OttoOS", note: "Day first, system beside it: Today / Inbox / Lists / Otto", needs: ["network"] },
  { id: "combined", label: "Combined", note: "Dark cards, stat tiles, team map", needs: ["network"] },
  { id: "hud", label: "Mission HUD", note: "Near-black console, mono type, cyan readouts, terminal log" },
  { id: "glass", label: "Glass", note: "Frosted cards on a navy gradient, pill buttons, floating tab bar" },
  { id: "hero", label: "Hero", note: "Big number up top, area chips, one-at-a-time Review" },
  { id: "rail", label: "Day rail", note: "Today as a timeline, decisions at the Now marker" }
];
