/* A short-horizon stat-arb model in the published shape of Medallion's
   (statarb/run.py -> data/statarb.json). */

import { loadJSON, showError, el, fmtPct, fmtDate, renderStats, renderTable, tok, breakdownColors } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { draw, lineConfig, applyChartDefaults } from "./charts.js";

const $ = (id) => document.getElementById(id);
let D = null, eqMode = "ls";
const NAMES = { fixed: "Three old signals, equal weight", ridge: "Ridge on 18 ranked traits", trees: "Boosted trees, depth 3" };
const r2 = (x) => (x == null ? "–" : x.toFixed(2));
const tcell = (t) => el("span", { class: t == null ? "note" : Math.abs(t) >= 3 ? (t > 0 ? "up" : "down") : "", text: t == null ? "–" : t.toFixed(1) });

function strip() {
  const best = ["ridge", "trees", "fixed"].map((k) => [k, D.models[k]]).sort((a, b) => (b[1].ic_5d.t || 0) - (a[1].ic_5d.t || 0))[0];
  const p = best[1].portfolios;
  renderStats("sa-strip", [
    { label: "Tested", value: `${D.days.toLocaleString()} days`, delta: `${D.oos_from.slice(0, 4)} to ${D.oos_to}, out of sample` },
    { label: "Names a day", value: Math.round(D.names_per_day).toLocaleString(), delta: `$${D.universe.min_price}+ price, $${(D.universe.min_dollar_volume / 1e6).toFixed(0)}m+ a day traded` },
    { label: "Best model's edge", value: best[1].ic_5d.mean.toFixed(3), delta: `rank IC, t ${r2(best[1].ic_5d.t)} · ${NAMES[best[0]].toLowerCase()}` },
    { label: "Sharpe before costs", value: r2(p["0bp"].long_short.sharpe), delta: `${fmtPct(p["0bp"].long_short.hit_rate, 0)} of days positive` },
    { label: "Sharpe at 25 bp a side", value: r2(p["25bp"].long_short.sharpe), delta: `at 50 bp: ${r2(p["50bp"].long_short.sharpe)}` },
  ]);
}

function known() {
  const box = $("sa-known"); box.innerHTML = "";
  const rows = [
    ["Horizon", "Positions held from a day and a half to a week and a half on average; 150,000 to 300,000 trades a day by the 2000s, many of them to build or hedge positions gradually (Zuckerman, 2019).", "Five-session hold, entered at the next close: the shortest honest horizon on daily closes."],
    ["Hit rate", "\"We're right 50.75 percent of the time… but we're 100 percent right 50.75 percent of the time\" (Mercer, quoted by Zuckerman).", "The share of days the long-short book is up is reported, not assumed."],
    ["Signals", "Mean reversion after a name \"got out of whack\", a week-long momentum effect, pairs, patterns at five-minute slices, and by 1997 more than half of the signals could not be explained; each had to clear p < 0.01 and hold over time.", "Eighteen price-and-volume traits, ranked; a linear and a tree model combine them. No intraday data, no order flow, no pairs."],
    ["One model", "Separate models were merged into a single system that sized every trade together and \"searched for other trades to tilt the portfolio\".", "One prediction per name per day from one fit; a decile book, equal weight. No optimiser."],
    ["Costs", "A model called \"the Devil\" tracked slippage against prediction; orders were timed to the heaviest volume to limit impact.", "Flat 10, 25 and 50 bp a side on every entry and exit; impact is not modelled, so the net figures flatter a real book."],
    ["Leverage", "Basket options with Barclays and Deutsche Bank gave about $20 of assets per dollar of cash; the Senate found about $34bn of income so sheltered (Senate PSI, 2014; Wikipedia).", "None. Returns are unlevered."],
    ["Refitting", "Models were re-estimated continuously on fresh data; a momentum model that lost $80–90m a day in March 2000 was pulled.", "Refit each quarter on the trailing three years and used unchanged on the next quarter."],
  ];
  rows.forEach(([k, a, b]) => box.appendChild(el("div", { class: "sa-row" }, [
    el("div", { class: "sa-k", text: k }), el("div", { class: "sa-a" }, [el("span", { class: "note", text: "Public record. " }), el("span", { text: a })]),
    el("div", { class: "sa-b" }, [el("span", { class: "note", text: "Here. " }), el("span", { text: b })])])));
}

function models() {
  const rows = ["fixed", "ridge", "trees"].map((k) => {
    const m = D.models[k], p = m.portfolios;
    return { key: k, name: NAMES[k], ic5: m.ic_5d.mean, ic5_t: m.ic_5d.t, ic1: m.ic_1d.mean, pos: m.ic_5d.share_positive,
      sh0: p["0bp"].long_short.sharpe, ret0: p["0bp"].long_short.ann_return, hit: p["0bp"].long_short.hit_rate, dd: p["0bp"].long_short.max_drawdown,
      lo0: p["0bp"].long_only.sharpe, turn: p["0bp"].turnover_one_way };
  });
  renderTable($("sa-models"), rows, [
    { key: "name", label: "Model" },
    { key: "ic5", label: "IC, 5 days", num: true, fmt: (v) => v.toFixed(4) },
    { key: "ic5_t", label: "t", num: true, fmt: tcell },
    { key: "ic1", label: "IC, 1 day", num: true, fmt: (v) => v.toFixed(4) },
    { key: "pos", label: "Days IC > 0", num: true, fmt: (v) => fmtPct(v, 0) },
    { key: "ret0", label: "Long-short a year", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "sh0", label: "Sharpe", num: true, fmt: r2 },
    { key: "hit", label: "Days up", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "dd", label: "Worst drawdown", num: true, fmt: (v) => fmtPct(v, 0) },
    { key: "lo0", label: "Long leg Sharpe", num: true, fmt: r2 },
    { key: "turn", label: "Turnover a day", num: true, fmt: (v) => fmtPct(v, 0) },
  ]);
  $("sa-m-meta").textContent = `${D.days.toLocaleString()} days · before costs`;
  const u = D.universe_equal_weight;
  $("sa-m-note").textContent = `IC is the daily Spearman correlation between the model's ranking and the realised return; t is Newey-West with five lags because the five-day targets overlap. ` +
    `The long-short book is top decile against bottom decile, equal weight, five overlapping five-day tranches, before costs. For scale, the universe held equal-weight returned ` +
    `${fmtPct(u.ann_return, 1)} a year at a Sharpe of ${r2(u.sharpe)} over the same days.`;
}

function equity() {
  const keys = ["fixed", "ridge", "trees"], cols = breakdownColors(keys.length);
  const labels = D.models.ridge.equity.map((p) => p.date);
  const cfg = lineConfig({ labels, yFmt: (v) => `$${v.toFixed(2)}`, series: keys.map((k, i) => ({
    label: NAMES[k], data: D.models[k].equity.map((p) => p[eqMode]), color: cols[i], width: 1.5 })) });
  cfg.options.plugins.legend = { display: false };
  cfg.options.scales.y.type = "logarithmic";
  cfg.options.scales.y.ticks = { ...(cfg.options.scales.y.ticks || {}), maxTicksLimit: 6 };
  draw("sa-eq-chart", cfg);
  const lg = $("sa-eq-legend"); lg.innerHTML = "";
  keys.forEach((k, i) => lg.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-line", style: `border-top-color:${cols[i]}` }), el("span", { text: NAMES[k] })])));
  $("sa-eq-note").textContent = eqMode === "ls"
    ? "Log scale. The long-short line is what the signal is worth before anyone pays to trade it; the table below is what survives the paying."
    : "Log scale. The long leg alone is what a TFSA could hold: the top decile, equal weight, rebalanced a fifth each day.";
}

function costs() {
  const rows = [];
  ["fixed", "ridge", "trees"].forEach((k) => {
    const p = D.models[k].portfolios;
    rows.push({ name: NAMES[k], c0: p["0bp"].long_short.sharpe, c10: p["10bp"].long_short.sharpe, c25: p["25bp"].long_short.sharpe, c50: p["50bp"].long_short.sharpe,
      r50: p["50bp"].long_short.ann_return, lo25: p["25bp"].long_only.sharpe });
  });
  renderTable($("sa-costs"), rows, [
    { key: "name", label: "Model" },
    { key: "c0", label: "Free", num: true, fmt: r2 },
    { key: "c10", label: "10 bp", num: true, fmt: r2 },
    { key: "c25", label: "25 bp", num: true, fmt: r2 },
    { key: "c50", label: "50 bp", num: true, fmt: r2 },
    { key: "r50", label: "Return at 50 bp", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "lo25", label: "Long leg at 25 bp", num: true, fmt: r2 },
  ]);
  $("sa-costs-note").textContent = "A fifth of the book turns over each day, so each day pays 2 × cost / 5 on the long-short book. 10 bp is what a large liquid " +
    "name costs to cross the spread; 25 to 50 bp is the honest range for a $5 stock with $2m a day of volume, before any market impact.";
}

function years() {
  const ys = Object.keys(D.models.ridge.ic_by_year);
  const rows = ys.map((y) => ({ year: y, fixed: D.models.fixed.ic_by_year[y], ridge: D.models.ridge.ic_by_year[y], trees: D.models.trees.ic_by_year[y],
    sh: D.models.ridge.portfolios["0bp"].by_year[y]?.sharpe, sh25: D.models.ridge.portfolios["25bp"].by_year[y]?.sharpe }));
  renderTable($("sa-years"), rows, [
    { key: "year", label: "Year" },
    { key: "fixed", label: "Fixed", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(3)) },
    { key: "ridge", label: "Ridge", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(3)) },
    { key: "trees", label: "Trees", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(3)) },
    { key: "sh", label: "Ridge Sharpe, free", num: true, fmt: r2 },
    { key: "sh25", label: "at 25 bp", num: true, fmt: r2 },
  ]);
}

function coefs() {
  const C = D.ridge_coefs;
  if (!C.length) return;
  // The six traits with the largest average absolute weight.
  const avg = D.features.map((f) => [f, C.reduce((s, r) => s + Math.abs(r[f]), 0) / C.length]).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
  const cols = breakdownColors(avg.length);
  const cfg = lineConfig({ labels: C.map((r) => r.quarter), yFmt: (v) => v.toFixed(2), series: avg.map((f, i) => ({
    label: D.labels[f], data: C.map((r) => r[f]), color: cols[i], width: 1.5 })) });
  cfg.options.plugins.legend = { display: false };
  cfg.options.scales.x.ticks = { maxTicksLimit: 12 };
  draw("sa-c-chart", cfg);
  const lg = $("sa-c-legend"); lg.innerHTML = "";
  avg.forEach((f, i) => lg.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-line", style: `border-top-color:${cols[i]}` }), el("span", { text: D.labels[f] })])));
}

(async function init() {
  renderShell();
  try { D = await loadJSON("data/statarb.json"); } catch (err) { showError($("error"), err); return; }
  setAsOf(D.as_of);
  strip(); known(); models(); equity(); costs(); years(); coefs();
  $("sa-method").textContent = D.method;
  $("sa-eq-mode").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    $("sa-eq-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b)); eqMode = b.dataset.k; equity(); }));
  onThemeChange(() => { applyChartDefaults(); equity(); coefs(); });
})();
