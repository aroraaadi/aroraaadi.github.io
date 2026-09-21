/* Research dashboard: model performance, holdings, methodology. */

import {
  loadJSON, showError, fmtPct, fmtNum, tok, breakdownColors, el,
  renderStats, buildLegend, renderTable, signClass,
} from "./common.js";
import {
  applyChartDefaults, draw, lineConfig, describeCanvas,
} from "./charts.js";
import { renderShell, setAsOf, onThemeChange, registerCommands } from "./shell.js";

let PERF = null, PORT = null, RISK = null, SIG = null;

/* Tiles and chart describe ONE object: the live record.

   They used not to. The tiles read stats.portfolio_live (49 days) while the
   chart plotted a spliced series whose first 678 points were a fabricated
   flat line, and the disclosure that would have said so was behind
   `if (!isLive)` and so never rendered. Every number here now carries the
   window it was measured on, and the period is stated next to the total. */
function renderTiles() {
  const s = PERF.stats.portfolio_live;
  const spx = PERF.stats.spx || {};
  const d = PERF.disclosure || {};

  if (!s) {
    renderStats("tiles", [
      { label: "Live record", value: "—", delta: "no rebalances recorded yet" },
      { label: "Positions", value: String(PORT.n_positions), delta: `model vol ${fmtPct(PORT.model_vol)}` },
    ]);
    return;
  }
  const vs = (k, fmt) => (spx[k] != null ? { delta: `S&P 500 ${fmt(spx[k])}` } : {});
  const gap = s.total_return - (spx.total_return ?? 0);
  renderStats("tiles", [
    { label: `Return, ${s.n_obs} sessions`, value: fmtPct(s.total_return, 1), tone: signClass(s.total_return),
      delta: `${gap >= 0 ? "+" : "−"}${(Math.abs(gap) * 100).toFixed(1)}pp vs S&P 500`,
      deltaTone: signClass(gap) },
    { label: "Volatility", value: fmtPct(s.vol),
      delta: `target ${PORT.vol_target_band.map((v) => fmtPct(v, 0)).join("–")}` },
    { label: "Sharpe", value: fmtNum(s.sharpe), ...vs("sharpe", (x) => x.toFixed(2)) },
    { label: "Max drawdown", value: fmtPct(s.max_dd), tone: "down", ...vs("max_dd", (x) => fmtPct(x)) },
    { label: "Positions", value: String(PORT.n_positions), delta: `model vol ${fmtPct(PORT.model_vol)}` },
  ]);

  const old = document.getElementById("hypo-note");
  if (old) old.remove();
  document.getElementById("tiles").insertAdjacentElement("afterend", el("p", {
    id: "hypo-note", class: "disclosure",
    text: `${s.n_obs} sessions is far too short to judge a strategy — an annualised ` +
          `figure from it would be noise, so none is shown. ${d.is_model_book || ""} ` +
          `${d.cost_model ? "Costs: " + d.cost_model + "." : ""}`,
  }));
}

function renderPerf() {
  const labels = PERF.dates;
  const series = [
    { label: "Model book", data: PERF.portfolio, color: tok("--usd"), order: 0, width: 2 },
    { label: "S&P 500", data: PERF.spx, color: tok("--ctx-1"), width: 1.5 },
    { label: "Nasdaq", data: PERF.comp, color: tok("--ctx-2"), width: 1.5 },
  ];
  buildLegend("perf-legend", series.map((x) => ({ label: x.label, color: x.color, shape: "line" })));
  // No liveMarker: every point on this chart IS live, so there is no boundary
  // to draw. It was marking a hypothetical region that no longer exists.
  draw("perf-chart", lineConfig({ labels, series, yFmt: (v) => v.toFixed(0) }));
  describeCanvas("perf-chart",
    `Growth of 100 over the live record, ${labels[0]} to ${labels[labels.length - 1]}, ` +
    `against the S&P 500 and Nasdaq rebased to the same day.`);
  const d = PERF.disclosure || {};
  document.getElementById("perf-note").textContent =
    `All three series start at 100 on ${PERF.live_start}, the first recorded rebalance. ` +
    (d.no_backtest || "");
}

function renderHoldings() {
  const rows = [...PORT.holdings].sort((a, b) => b.weight - a.weight).map((h) => ({
    ticker: h.ticker, sector: h.sector, weight: h.weight, alpha: h.alpha_score,
    value: h.signals?.value, quality: h.signals?.quality,
    momentum: h.signals?.momentum, short: h.signals?.short_interest,
    pe: h.raw?.pe,
  }));
  const order = rows.map((r) => r.ticker);
  // breakdownColors, not slotColor: there are 15 holdings and only 8 validated
  // hues, so slotColor painted rows 9-15 the same grey.
  const colors = breakdownColors(rows.length);
  const sig = (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2));
  const sigCls = (k) => (r) => (r[k] > 0.5 ? "pos" : r[k] < -0.5 ? "neg" : "");

  renderTable(document.getElementById("holdings-table"), rows, [
    { key: "ticker", label: "Ticker", fmt: (v) => el("span", {}, [
        el("span", { class: "dot", style: `background:${colors[order.indexOf(v)]}` }),
        el("span", { class: "sym", text: v })]) },
    { key: "sector", label: "Sector" },
    { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "alpha", label: "Alpha", num: true, fmt: sig, cls: sigCls("alpha") },
    { key: "value", label: "Value", num: true, fmt: sig, cls: sigCls("value") },
    { key: "quality", label: "Quality", num: true, fmt: sig, cls: sigCls("quality") },
    { key: "momentum", label: "Momentum", num: true, fmt: sig, cls: sigCls("momentum") },
    { key: "short", label: "Short int.", num: true, fmt: sig, cls: sigCls("short") },
    { key: "pe", label: "P/E", num: true, fmt: (v) => (v == null ? "—" : v.toFixed(1)) },
  ], { sortKey: "weight", dir: -1 });

  const pending = PORT.pending?.length ? ` ${PORT.pending.length} name(s) seasoning and held out.` : "";
  document.getElementById("holdings-note").textContent =
    `${rows.length} positions · scores are cross-sectional z-ranks.${pending}`;
}

function renderMethodology() {
  const w = SIG?.weights || {};
  const parts = Object.entries(w).map(([k, v]) => `${k} ${fmtPct(v, 0)}`).join(", ");
  document.getElementById("methodology").innerHTML = `
    <h3>Signals</h3>
    <p>Cross-sectional scores, Gaussian-rank standardised and
    ${PORT.sector_neutral ? "neutralised within GICS sector" : "not sector-neutralised"} before ranking.
    Current weighting is <code>${SIG?.weighting || "static"}</code>${parts ? ` — ${parts}` : ""}.</p>
    <h3>Risk model</h3>
    <p>${RISK ? `Statistical factor model, Σ = B F Bᵀ + D. Factors explain
       ${RISK.factors_explained_var.map((v) => fmtPct(v, 0)).join(", ")} of variance;
       equal-weight vol ${fmtPct(RISK.eq_weight_vol?.pca)} on the factor model,
       ${fmtPct(RISK.eq_weight_vol?.realized)} realised.` : "Risk diagnostics unavailable."}</p>
    <h3>Construction</h3>
    <p>Long-only, fully invested, max ${fmtPct(PORT.max_weight, 0)} per name, targeting the
    ${PORT.vol_target_band.map((v) => fmtPct(v, 0)).join("–")} volatility band
    (${PORT.vol_band_met ? "met" : "not met"} this run at ${fmtPct(PORT.model_vol)};
    long-only minimum-variance is ${fmtPct(PORT.min_var_vol)}).</p>
    <p class="note">The full chain, with the papers behind each step and what it does
    not claim, is on the <a href="${window.ASSET_BASE || ""}methodology.html">methodology page</a>.</p>`;
}

function renderAll() {
  applyChartDefaults();
  renderTiles();
  renderPerf();
  renderHoldings();
  renderMethodology();
}

(async function init() {
  renderShell();
  const content = document.getElementById("content");
  try {
    [PERF, PORT] = await Promise.all([
      loadJSON("data/performance.json"), loadJSON("data/portfolio.json"),
    ]);
    RISK = await loadJSON("data/risk.json").catch(() => null);
    SIG = await loadJSON("data/signals.json").catch(() => null);
  } catch (err) { showError(content, err); return; }
  setAsOf(PORT.as_of);
  registerCommands(PORT.holdings.map((h) => ({ key: h.ticker, hint: h.sector })));
  renderAll();
  onThemeChange(renderAll);
})();
