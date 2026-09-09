/* Dashboard / Positions / Holdings — element-guarded so one module serves the
   three "my" pages that share a data source. */

import {
  loadJSON, showError, fmtPct, fmtNum, fmtSigned, fmtDate, signClass,
  tok, slotColor, slotColors, breakdownColors, el, renderStats, buildLegend, renderTable,
} from "./common.js";
import {
  applyChartDefaults, draw, lineConfig, doughnutConfig, hbarConfig, describeCanvas,
} from "./charts.js";
import { renderShell, setAsOf, onThemeChange, registerCommands } from "./shell.js";

let PF = null, PHIST = [], MET = null;

/* Positions are published as the USD-equivalent view where available: CDRs are
   mapped to their US underlying and duplicate lines merged, so META held two
   ways is one exposure rather than two. */
const positions = () => (PF.usd_positions || PF.positions || []);

function renderTopStats() {
  const host = document.getElementById("stats");
  if (!host) return;
  const rows = positions();
  const top = [...rows].sort((a, b) => b.weight - a.weight)[0];
  const usd = rows.filter((p) => p.currency === "USD").reduce((s, p) => s + p.weight, 0);
  const stale = rows.filter((p) => p.stale_price);

  const defs = [
    { label: "Positions", value: String(rows.length),
      delta: top ? `${top.symbol} largest ${fmtPct(top.weight)}` : null },
    { label: "USD / CAD", value: `${Math.round(usd * 100)} / ${Math.round((1 - usd) * 100)}`,
      delta: "share of book" },
  ];
  if (PHIST.length) {
    const last = PHIST[PHIST.length - 1];
    const twr = last.twr_index / 100 - 1;
    const spx = last.spx_index / 100 - 1;
    defs.push({ label: "Time-weighted return", value: fmtSigned(twr), tone: signClass(twr),
                delta: `S&P 500 ${fmtSigned(spx)}`, deltaTone: signClass(spx - twr) });
  }
  if (stale.length) {
    defs.push({ label: "Stale prices", value: String(stale.length),
                tone: "down", delta: stale.map((s) => s.symbol).join(", ") });
  }
  renderStats(host, defs);
}

function renderRisk() {
  const host = document.getElementById("risk");
  if (!host || !MET) return;
  renderStats(host, [
    { label: "Beta vs S&P 500", value: fmtNum(MET.beta),
      delta: MET.beta > 1 ? "amplifies the market" : "dampens the market" },
    { label: "Volatility (ann.)", value: fmtPct(MET.vol_annual) },
    { label: "Max drawdown", value: fmtPct(MET.max_drawdown), tone: "down" },
    { label: "Sharpe", value: fmtNum(MET.sharpe) },
    { label: "Sortino", value: fmtNum(MET.sortino) },
  ]);
  host.style.borderRadius = "0";

  const cov = MET.coverage != null ? ` (${Math.round(MET.coverage * 100)}% of the book with price data)` : "";
  document.getElementById("risk-window").textContent =
    MET.years ? `${MET.years.toFixed(1)}y window` : "";
  document.getElementById("risk-note").textContent =
    `Current holdings applied over the past ${MET.years ? MET.years.toFixed(1) : "3"} years${cov} — ` +
    `hypothetical, since weights change over time. Actual worst peak-to-trough on the monthly ` +
    `equity curve: ${fmtPct(MET.max_drawdown_actual ?? MET.max_drawdown)}.`;
}

function renderValue() {
  if (!document.getElementById("value-chart") || !PHIST.length) return;
  const labels = PHIST.map((p) => p.date);
  const series = [
    { label: "Portfolio", data: PHIST.map((p) => p.value_index), color: tok("--s6") },
    { label: "Net contributions", data: PHIST.map((p) => p.invested_index),
      color: tok("--ctx-1"), dash: [5, 4], width: 1.5 },
  ];
  buildLegend("value-legend", series.map((s) => ({ label: s.label, color: s.color, shape: "line" })));
  draw("value-chart", lineConfig({ labels, series, yFmt: (v) => Math.round(v) }));
  describeCanvas("value-chart",
    `Portfolio value indexed to 100 at January 2024, ${PHIST.length} monthly points.`);
  document.getElementById("value-note").textContent =
    "Indexed to 100 at Jan 2024. The gap between the lines is market gain versus money deposited.";
}

/* Complete allocation: every position, no "Other" bucket. Because 17 slices
   exceed the 8 validated hues, colour is a secondary cue only — the exact
   weight is printed beside every entry in the breakdown list, so the chart is
   never the sole way to read a value. */
function renderAllocation() {
  if (!document.getElementById("alloc-chart")) return;
  const rows = [...positions()].sort((a, b) => b.weight - a.weight);
  const labels = rows.map((p) => p.symbol);
  const values = rows.map((p) => +(p.weight * 100).toFixed(2));
  const colors = breakdownColors(rows.length);

  draw("alloc-chart", doughnutConfig({ labels, values, colors }));
  describeCanvas("alloc-chart",
    `Allocation across all ${rows.length} positions: ` +
    labels.map((l, i) => `${l} ${values[i]}%`).join(", ") + ".");

  // Full breakdown beside the ring — every position, its share and a bar.
  const host = document.getElementById("alloc-breakdown");
  if (!host) return;
  const max = values[0] || 1;
  host.innerHTML = "";
  rows.forEach((p, i) => {
    host.appendChild(el("div", { class: "alloc-row" }, [
      el("span", { class: "dot", style: `background:${colors[i]}` }),
      el("span", { class: "sym", text: p.symbol }),
      el("span", { class: "meter" },
         [el("i", { style: `width:${(values[i] / max * 100).toFixed(1)}%;background:${colors[i]}` })]),
      el("span", { class: "num", text: fmtPct(p.weight, 2) }),
    ]));
  });
  const total = values.reduce((s, v) => s + v, 0);
  host.appendChild(el("div", { class: "alloc-row total" }, [
    el("span", {}), el("span", { text: `${rows.length} positions` }),
    el("span", {}), el("span", { class: "num", text: total.toFixed(2) + "%" }),
  ]));
}

function renderPositionsTable() {
  const table = document.getElementById("pos-table");
  if (!table) return;
  const rows = positions().map((p) => ({
    symbol: p.symbol,
    kind: p.kind || "stock",
    currency: p.currency || "",
    weight: p.weight,
    held: (p.held_as || []).join(" + "),
    stale: !!p.stale_price,
  }));
  const order = [...rows].sort((a, b) => b.weight - a.weight).map((r) => r.symbol);

  renderTable(table, rows, [
    { key: "symbol", label: "Symbol", fmt: (v, r) => {
        const i = order.indexOf(v);
        return el("span", {}, [
          el("span", { class: "dot", style: `background:${slotColor(i)}` }),
          el("span", { class: "sym", text: v }),
        ]);
      } },
    { key: "kind", label: "Type" },
    { key: "currency", label: "Ccy" },
    { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "held", label: "Held as", fmt: (v, r) =>
        v && v !== r.symbol ? el("span", { class: "pill", text: v }) : "—" },
    { key: "stale", label: "Price", fmt: (v) =>
        v ? el("span", { class: "pill warn", text: "book cost" }) : el("span", { class: "note", text: "live" }) },
  ], { sortKey: "weight", dir: -1 });

  document.getElementById("pos-count").textContent = `${rows.length} positions`;
}

function renderWeightBars() {
  if (!document.getElementById("weights-chart")) return;
  const rows = [...positions()].sort((a, b) => b.weight - a.weight);
  const labels = rows.map((p) => p.symbol);
  const values = rows.map((p) => +(p.weight * 100).toFixed(2));
  const colors = rows.map((p) => (p.currency === "USD" ? tok("--s6") : tok("--s4")));
  buildLegend("weights-legend", [
    { label: "USD", color: tok("--s6"), shape: "rect" },
    { label: "CAD", color: tok("--s4"), shape: "rect" },
  ]);
  document.getElementById("weights-box").style.height = `${40 + rows.length * 22}px`;
  draw("weights-chart", hbarConfig({
    labels, values, colors, valueLabels: values.map((v) => v.toFixed(2) + "%"),
  }));
  describeCanvas("weights-chart", `Position weights: ${labels.map((l, i) => `${l} ${values[i]}%`).join(", ")}.`);
}

function renderAll() {
  applyChartDefaults();
  renderTopStats();
  renderRisk();
  renderValue();
  renderAllocation();
  renderPositionsTable();
  renderWeightBars();
}

(async function init() {
  renderShell();
  const content = document.getElementById("content");
  try {
    PF = await loadJSON("data/current_portfolio.json");
    PHIST = await loadJSON("data/portfolio_history.json").catch(() => []);
    MET = await loadJSON("data/portfolio_metrics.json").catch(() => null);
  } catch (err) {
    showError(content, err);
    return;
  }
  setAsOf(PF.as_of);
  registerCommands(positions().map((p) => ({
    key: p.symbol, hint: "holding",
    go: `${window.ASSET_BASE}my/fundamentals.html#${p.symbol}`,
  })));
  renderAll();
  onThemeChange(renderAll);
})();
