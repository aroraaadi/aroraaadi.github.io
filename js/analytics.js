/* Risk analytics for one book: return, market sensitivity, tail risk,
   concentration. The USD book can also show the engine's target weights
   through the same lens — that is how you see whether the model you would
   deploy is riskier than the book you hold. */

import {
  loadJSON, showError, fmtPct, fmtNum, tok, alpha, slotColor, el,
  renderStats, buildLegend, renderTable, breakdownColors,
} from "./common.js";
import { applyChartDefaults, draw, describeCanvas, crosshair } from "./charts.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";

const BOOK = document.querySelector("main").dataset.book;
let M = null, VIEW = "held", RISK = null, PF = null;
const pct = (x, dp = 1) => fmtPct(x, dp);

function groups() {
  renderStats("g-return", [
    { label: "CAGR", value: pct(M.cagr) },
    { label: "Volatility", value: pct(M.vol_annual) },
    { label: "Sharpe", value: fmtNum(M.sharpe) },
    { label: "Sortino", value: fmtNum(M.sortino) },
    { label: "Calmar", value: fmtNum(M.calmar) },
    { label: "Max drawdown", value: pct(M.max_drawdown), tone: "down" },
    { label: "Downside dev.", value: pct(M.downside_dev) },
  ]);
  renderStats("g-market", [
    { label: "Beta", value: fmtNum(M.beta) },
    { label: "Beta down", value: fmtNum(M.beta_down) },
    { label: "Beta up", value: fmtNum(M.beta_up) },
    { label: "Beta asymmetry", value: fmtNum(M.beta_asymmetry), tone: M.beta_asymmetry > 0 ? "down" : "up" },
    { label: "Alpha (ann.)", value: pct(M.alpha_annual), tone: M.alpha_annual > 0 ? "up" : "down" },
    { label: "Correlation", value: fmtNum(M.correlation) },
    { label: "R²", value: fmtNum(M.r_squared ?? M.r2) },
    { label: "Up capture", value: fmtNum(M.up_capture) },
    { label: "Down capture", value: fmtNum(M.down_capture) },
    { label: "Tracking error", value: pct(M.tracking_error) },
    { label: "Information ratio", value: fmtNum(M.information_ratio) },
  ]);
  renderStats("g-tail", [
    { label: "VaR 95%", value: pct(M.var95), tone: "down" },
    { label: "CVaR 95%", value: pct(M.cvar95), tone: "down" },
    { label: "Skew", value: fmtNum(M.skew) },
    { label: "Kurtosis", value: fmtNum(M.kurtosis) },
    { label: "Positive days", value: pct(M.pct_positive ?? M.positive_days) },
    { label: "Best day", value: pct(M.best_day), tone: "up" },
    { label: "Worst day", value: pct(M.worst_day), tone: "down" },
  ]);
  renderStats("g-conc", [
    { label: "HHI", value: fmtNum(M.hhi, 4) },
    { label: "Effective names", value: fmtNum(M.effective_n) },
    { label: "Top 5 weight", value: pct(M.top5_weight) },
    { label: "Top 10 weight", value: pct(M.top10_weight) },
    { label: "Sector HHI", value: fmtNum(M.hhi_sector, 3) },
  ]);
  document.getElementById("market-title").textContent = `Market sensitivity vs ${M.benchmark || "benchmark"}`;
  document.getElementById("bench-note").textContent = `benchmark ${M.benchmark || "—"} · ${M.window_days} trading days`;
}

function drawdown() {
  const s = M.series?.drawdown, d = M.series?.dates;
  if (!s) return;
  draw("dd-chart", {
    type: "line",
    data: { labels: d, datasets: [{
      data: s, borderColor: tok("--down"), backgroundColor: alpha("--down", 0.16),
      fill: true, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, border: { color: tok("--baseline") },
             ticks: { maxTicksLimit: 7, callback: (v) => (d[v] || "").slice(0, 7) } },
        y: { max: 0, grid: { color: tok("--grid") }, border: { display: false },
             ticks: { callback: (v) => (v * 100).toFixed(0) + "%" } },
      },
      plugins: { tooltip: { callbacks: { label: (c) => ` drawdown ${pct(c.parsed.y)}` } } },
    },
    plugins: [crosshair],
  });
  describeCanvas("dd-chart", `Drawdown curve, worst ${pct(M.max_drawdown)}.`);
  document.getElementById("dd-note").textContent = `Peak-to-trough decline. Worst: ${pct(M.max_drawdown)}.`;
}

function histogram() {
  const r = M.series?.port;
  if (!r) return;
  const lo = Math.min(...r), hi = Math.max(...r), bins = 41, w = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  for (const x of r) counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++;
  const centers = counts.map((_, i) => lo + w * (i + 0.5));
  draw("hist-chart", {
    type: "bar",
    data: { labels: centers.map((c) => (c * 100).toFixed(1)), datasets: [{
      data: counts, barPercentage: 1, categoryPercentage: 1,
      backgroundColor: centers.map((c) => alpha(c < 0 ? "--down" : "--up", 0.8)) }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, border: { color: tok("--baseline") },
             ticks: { maxTicksLimit: 9, callback(v) { return this.getLabelForValue(v) + "%"; } } },
        y: { grid: { color: tok("--grid") }, border: { display: false } },
      },
      plugins: { tooltip: { callbacks: {
        title: (i) => `${i[0].label}% daily return`, label: (c) => ` ${c.parsed.y} days` } } },
    },
  });
  describeCanvas("hist-chart", `Daily return distribution, ${r.length} observations, skew ${fmtNum(M.skew)}.`);
  document.getElementById("hist-note").textContent =
    `${r.length} daily observations · skew ${fmtNum(M.skew)} · kurtosis ${fmtNum(M.kurtosis)}.`;
}

function sectors() {
  const s = M.sector_exposure;
  if (!s?.length) return;
  const colors = s.map((_, i) => slotColor(i));
  buildLegend("sector-legend", s.map((x, i) => ({ label: x.sector, color: colors[i], shape: "rect" })));
  document.getElementById("sector-box").style.height = `${40 + s.length * 26}px`;
  draw("sector-chart", {
    type: "bar",
    data: { labels: s.map((x) => x.sector), datasets: [{
      data: s.map((x) => +(x.weight * 100).toFixed(2)), backgroundColor: colors,
      barThickness: 14, borderRadius: { topRight: 2, bottomRight: 2 }, borderSkipped: "start" }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 48 } },
      scales: {
        x: { grid: { color: tok("--grid") }, border: { display: false }, ticks: { callback: (v) => v + "%" } },
        y: { grid: { display: false }, border: { color: tok("--baseline") } },
      },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.parsed.x}%` } } },
    },
  });
  describeCanvas("sector-chart", `Sector exposure: ${s.map((x) => `${x.sector} ${(x.weight * 100).toFixed(1)}%`).join(", ")}.`);
  document.getElementById("conc-note").textContent =
    `Effective names ${fmtNum(M.effective_n)} of ${(M.risk_contrib || []).length} — HHI ${fmtNum(M.hhi, 4)}.`;
}

/* 1/HHI measures how spread the WEIGHTS are; the Meucci measure counts
   independent RISK sources. On a thematically concentrated book they diverge
   hard, and only the second one answers "am I diversified". */
function diversification() {
  const eb = M.effective_bets, n = (M.risk_contrib || []).length;
  renderStats("g-div", [
    { label: "Positions", value: String(n) },
    { label: "1/HHI effective names", value: fmtNum(M.effective_n, 1), delta: "weight dispersion" },
    { label: "Effective bets (risk)", value: eb == null ? "—" : fmtNum(eb, 2),
      tone: eb != null && eb < 3 ? "down" : "", delta: "independent risk sources" },
    { label: "PC1 share of variance", value: fmtPct(M.pc1_share, 0), tone: M.pc1_share > 0.5 ? "down" : "" },
    { label: "Top-5 weight", value: fmtPct(M.top5_weight) },
  ]);
  document.getElementById("div-note").textContent = eb == null ? "" :
    `${n} positions, but only ${eb.toFixed(1)} independent bets — the first principal component alone carries ` +
    `${fmtPct(M.pc1_share, 0)} of portfolio variance. 1/HHI reports ${fmtNum(M.effective_n, 1)} because it measures ` +
    `how evenly the weights are spread, not how independent the holdings are.`;
}

function themes() {
  const host = document.getElementById("theme-bars");
  const t = M.theme_exposure || {};
  const keys = Object.keys(t);
  host.innerHTML = "";
  if (!keys.length || (keys.length === 1 && keys[0] === "untagged")) {
    host.textContent = "No theme classification for these names — the ETF-intersection signal covers US-listed names.";
    document.getElementById("theme-note").textContent = "";
    return;
  }
  const colors = breakdownColors(keys.length);
  const max = Math.max(...Object.values(t), 0.01);
  keys.forEach((k, i) => {
    const c = k === "untagged" ? tok("--muted") : colors[i];
    host.appendChild(el("div", { class: "alloc-row" }, [
      el("span", { class: "dot", style: `background:${c}` }),
      el("span", { class: "sym", text: k }),
      el("span", { class: "meter" }, [el("i", { style: `width:${(t[k] / max * 100).toFixed(1)}%;background:${c}` })]),
      el("span", { class: "num", text: fmtPct(t[k], 1) }),
    ]));
  });
  document.getElementById("theme-note").textContent =
    `${fmtPct(1 - (t.untagged || 0), 0)} of the book carries a theme tag. Classification is the ETF-intersection ` +
    `signal only, so it reflects what thematic ETFs own, not measured revenue exposure.`;
}

function riskContrib() {
  const table = document.getElementById("rc-table");
  if (!M.risk_contrib?.length) return;
  const rows = M.risk_contrib.map((r) => ({ ...r, ratio: r.weight ? r.pct_risk / r.weight : null }));
  renderTable(table, rows, [
    { key: "symbol", label: "Name", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "pct_risk", label: "% of risk", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "ratio", label: "Risk / weight", num: true,
      cls: (r) => (r.ratio > 1.25 ? "neg" : r.ratio < 0.8 ? "pos" : ""),
      fmt: (v) => (v == null ? "—" : v.toFixed(2) + "x") },
  ], { sortKey: "pct_risk", dir: -1 });
}

/* The PCA risk model is fitted on the USD trading universe, so these loadings
   are a property of the NAME; only the "held" marker moves. The panel is
   hidden for the CAD book, whose names are not in that universe. */
function factorExposures() {
  const panel = document.getElementById("fx-panel");
  const table = document.getElementById("fx-table");
  if (!RISK?.exposures || BOOK !== "usd") { panel.hidden = true; return; }
  const ev = RISK.factors_explained_var || [];
  const held = new Set((M.risk_contrib || []).map((r) => r.symbol));
  const rows = Object.entries(RISK.exposures).map(([symbol, l]) => ({
    symbol, held: held.has(symbol), f1: l[0], f2: l[1], f3: l[2],
    idio: RISK.idio_share?.[symbol] ?? null, vol: RISK.vol?.[symbol] ?? null,
  }));
  const load = (v) => (v == null ? "—" : v.toFixed(2));
  const fLabel = (i) => `PC${i + 1}${ev[i] != null ? ` (${fmtPct(ev[i], 0)})` : ""}`;
  renderTable(table, rows, [
    { key: "symbol", label: "Name", fmt: (v, r) => el("span", { class: "sym" + (r.held ? "" : " muted"), text: v }) },
    { key: "f1", label: fLabel(0), num: true, fmt: load },
    { key: "f2", label: fLabel(1), num: true, fmt: load },
    { key: "f3", label: fLabel(2), num: true, fmt: load },
    { key: "vol", label: "Vol", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v, 0)) },
    { key: "idio", label: "Idiosyncratic", num: true,
      cls: (r) => (r.idio > 0.6 ? "pos" : r.idio < 0.35 ? "neg" : ""),
      fmt: (v) => (v == null ? "—" : fmtPct(v, 0)) },
  ], { sortKey: "idio", dir: -1 });
  const covered = rows.filter((r) => r.held).length;
  document.getElementById("fx-note").textContent =
    `${rows.length} names in the risk model, ${covered} of them in the ${VIEW === "model" ? "target" : "held"} book. ` +
    `Idiosyncratic is the share of a name's own variance the factors do not explain — high means it genuinely ` +
    `diversifies, low means it is a proxy for risk you already own.`;
}

function renderAll() {
  applyChartDefaults();
  groups(); diversification(); themes(); riskContrib(); factorExposures();
  drawdown(); histogram(); sectors();
}

async function loadView(which) {
  const file = which === "model" ? "data/model_metrics.json" : `data/metrics_${BOOK}.json`;
  M = await loadJSON(file);
  VIEW = which;
  document.getElementById("book-note").textContent =
    which === "model" ? `The engine's target weights as of ${M.book_as_of || "—"} — not what is held.`
                      : `The held book as of ${M.book_as_of || "—"}.`;
  setAsOf(M.as_of);
  const yrs = M.window_days ? (M.window_days / 252).toFixed(1) : "3";
  document.getElementById("intro").textContent =
    (which === "model" ? "The engine's target weights" : "Current holdings") +
    ` applied over the past ${yrs} years against the ${M.benchmark}` +
    (M.coverage_pct != null ? ` (${Math.round(M.coverage_pct * 100)}% of the book with price data)` : "") +
    " — hypothetical, since weights change over time. Cash is excluded.";
  renderAll();
}

(async function init() {
  renderShell();
  RISK = await loadJSON("data/risk.json").catch(() => null);
  PF = await loadJSON("data/current_portfolio.json").catch(() => null);
  const b = PF?.books?.[BOOK];
  document.getElementById("book-eyebrow").textContent = b ? `${b.label} · ${b.currency}` : BOOK.toUpperCase();
  try { await loadView("held"); }
  catch (err) { showError(document.getElementById("error"), err); return; }
  if (BOOK === "usd") {
    document.getElementById("book-controls").hidden = false;
    document.getElementById("book").addEventListener("click", async (e) => {
      const btn = e.target.closest("button"); if (!btn) return;
      [...e.currentTarget.children].forEach((c) => c.classList.toggle("active", c === btn));
      try { await loadView(btn.dataset.v); }
      catch (err) { document.getElementById("book-note").textContent = `Unavailable: ${err.message}`; }
    });
  }
  onThemeChange(renderAll);
})();
