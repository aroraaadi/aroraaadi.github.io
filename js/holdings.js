/* Rebalance changes + composition over time. */

import {
  loadJSON, showError, fmtPct, tok, slotColor, el, buildLegend, renderTable,
} from "./common.js";
import { applyChartDefaults, draw, describeCanvas } from "./charts.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";

let HIST = [];

function renderChanges() {
  const entries = [...HIST].sort((a, b) => a.date.localeCompare(b.date));
  const cur = entries[entries.length - 1];
  const prev = entries.length > 1 ? entries[entries.length - 2] : null;
  const names = new Set([...Object.keys(cur.weights), ...Object.keys(prev?.weights || {})]);

  const rows = [...names].map((t) => {
    const w = cur.weights[t] || 0;
    const p = prev ? (prev.weights[t] || 0) : null;
    return { ticker: t, weight: w, prev: p, change: p == null ? null : w - p,
             isNew: p === 0 || p == null };
  });

  renderTable(document.getElementById("changes-table"), rows, [
    { key: "ticker", label: "Ticker", fmt: (v, r) => el("span", {}, [
        el("span", { class: "sym", text: v }),
        r.isNew && prev ? el("span", { class: "pill up", text: "new", style: "margin-left:8px" }) : null,
      ]) },
    { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "prev", label: "Previous", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v, 2)) },
    { key: "change", label: "Change", num: true,
      cls: (r) => (r.change > 0 ? "pos" : r.change < 0 ? "neg" : ""),
      fmt: (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "pp") },
  ], { sortKey: "weight", dir: -1 });

  document.getElementById("turnover-note").textContent =
    `${cur.date} · one-way turnover ${fmtPct(cur.turnover)} · model vol ${fmtPct(cur.model_vol)}`;
}

function renderComposition() {
  const entries = [...HIST].sort((a, b) => a.date.localeCompare(b.date));
  const totals = new Map();
  for (const e of entries) for (const [t, w] of Object.entries(e.weights))
    totals.set(t, (totals.get(t) || 0) + w);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]);

  const sets = top.map((t, i) => ({
    label: t,
    data: entries.map((e) => +((e.weights[t] || 0) * 100).toFixed(2)),
    backgroundColor: slotColor(i),
    borderColor: tok("--surface"), borderWidth: 1,
  }));
  sets.push({
    label: "Other",
    data: entries.map((e) => +(Object.entries(e.weights)
      .filter(([t]) => !top.includes(t)).reduce((s, [, w]) => s + w, 0) * 100).toFixed(2)),
    backgroundColor: tok("--muted"), borderColor: tok("--surface"), borderWidth: 1,
  });

  buildLegend("comp-legend", sets.map((s) => ({ label: s.label, color: s.backgroundColor, shape: "rect" })));
  document.getElementById("comp-box").style.height = `${60 + entries.length * 44}px`;
  draw("comp-chart", {
    type: "bar",
    data: { labels: entries.map((e) => e.date), datasets: sets },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true, max: 100, grid: { color: tok("--grid") }, border: { display: false },
             ticks: { callback: (v) => v + "%" } },
        y: { stacked: true, grid: { display: false }, border: { color: tok("--baseline") } },
      },
      interaction: { mode: "nearest", intersect: true },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.x}%` } } },
    },
  });
  describeCanvas("comp-chart", `Stacked composition across ${entries.length} rebalances.`);
}

function renderAll() {
  applyChartDefaults();
  renderChanges();
  renderComposition();
}

(async function init() {
  renderShell();
  const content = document.getElementById("content");
  try { HIST = await loadJSON("data/holdings_history.json"); }
  catch (err) { showError(content, err); return; }
  if (!HIST.length) { showError(content, new Error("no rebalance history yet")); return; }
  setAsOf([...HIST].sort((a, b) => a.date.localeCompare(b.date)).pop().date);
  renderAll();
  onThemeChange(renderAll);
})();
