/* Held vs model: the USD Questrade book as held against the engine's
   suggestion, day by day (held_vs_model.py). */

import { loadJSON, showError, el, fmtPct, fmtDate, renderStats, renderTable, tok, signedPct, tone } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { draw, lineConfig, applyChartDefaults } from "./charts.js";

const $ = (id) => document.getElementById(id);
let D = null;

function head() {
  const S = D.summary;
  $("hm-title").textContent = S.difference >= 0
    ? `What you hold is ahead of the model by ${(S.difference * 100).toFixed(2)} points`
    : `The model is ahead of what you hold by ${(-S.difference * 100).toFixed(2)} points`;
  $("hm-sub").textContent = `Since ${fmtDate(D.since)}, when the USD account became its own book: held ${signedPct(S.held, 2)}, ` +
    `the model's suggestion ${signedPct(S.model, 2)}, over ${D.sessions} sessions. The two books share ${fmtPct(S.overlap, 0)} of their weight today.`;
  renderStats("hm-strip", [
    { label: "Held", value: signedPct(S.held, 2), tone: tone(S.held), delta: `including ${fmtPct(S.cash, 1)} cash` },
    { label: "Model's suggestion", value: signedPct(S.model, 2), tone: tone(S.model), delta: "fully invested, no costs" },
    { label: "Difference", value: signedPct(S.difference, 2), tone: tone(S.difference), delta: S.difference >= 0 ? "held ahead" : "model ahead" },
    { label: "Days held was ahead", value: `${S.days_held_ahead} of ${D.sessions}`, delta: "session by session" },
    { label: "Overlap", value: fmtPct(S.overlap, 0), delta: "weight the two books share" },
  ]);
}

function chart() {
  const accent = tok("--accent"), ink = tok("--ink-2");
  const cfg = lineConfig({ labels: D.series.map((p) => p.date), yFmt: (v) => `${v >= 100 ? "+" : ""}${(v - 100).toFixed(1)}%`, series: [
    { label: "Held", data: D.series.map((p) => p.held), color: accent, width: 2 },
    { label: "Model's suggestion", data: D.series.map((p) => p.model), color: ink, width: 1.5, dash: [4, 3] },
  ] });
  cfg.options.plugins.legend = { display: false };
  cfg.options.plugins.tooltip = { callbacks: { label: (c) => ` ${c.dataset.label}: ${signedPct(c.parsed.y / 100 - 1, 2)}` } };
  draw("hm-chart", cfg);
  const lg = $("hm-legend"); lg.innerHTML = "";
  [["Held", accent], ["Model's suggestion", ink]].forEach(([t, c]) =>
    lg.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-line", style: `border-top-color:${c}` }), el("span", { text: t })])));
  $("hm-meta").textContent = `${fmtDate(D.since)} to ${fmtDate(D.as_of)}`;
  const M = D.method;
  $("hm-note").textContent = `${M.held} ${M.model} ${M.costs}`;
}

function weights() {
  renderTable($("hm-table"), D.weights, [
    { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "held", label: "Held", num: true, fmt: (v) => (v ? fmtPct(v, 1) : "–") },
    { key: "model", label: "Model", num: true, fmt: (v) => (v ? fmtPct(v, 1) : "–") },
    { key: "gap", label: "Held less model", num: true, fmt: (v) => el("span", { class: `tk-vs ${tone(v)}`, text: signedPct(v, 1) }) },
  ], { sortKey: "held", dir: -1 });
  $("hm-w-meta").textContent = `${D.weights.filter((r) => r.held).length} held · ${D.weights.filter((r) => r.model).length} in the model`;
  $("hm-w-note").textContent = `${D.method.adopted} Weights are of each book's invested value.`;
}

(async function init() {
  renderShell();
  try { D = await loadJSON("data/held_vs_model.json"); } catch (err) { showError($("error"), err); return; }
  setAsOf(D.as_of);
  head(); chart(); weights();
  onThemeChange(() => { applyChartDefaults(); chart(); });
})();
