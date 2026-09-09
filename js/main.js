/* Research dashboard: model performance, holdings, methodology. */

import {
  loadJSON, showError, fmtPct, fmtNum, fmtSigned, tok, slotColor, el,
  renderStats, buildLegend, renderTable, signClass,
} from "./common.js";
import {
  applyChartDefaults, draw, lineConfig, liveMarker, describeCanvas,
} from "./charts.js";
import { renderShell, setAsOf, onThemeChange, registerCommands } from "./shell.js";

let PERF = null, PORT = null, RISK = null, SIG = null;

/* Prefer the live track record. Fall back to the hypothetical ONLY with an
   explicit label and NO benchmark comparison: those figures come from holding
   today's optimised weights over the window they are measured on, so a
   "vs SPX" delta on them is guaranteed positive by construction rather than
   earned. This is deliberate — do not "simplify" it into one number. */
function renderTiles() {
  const live = PERF.stats.portfolio_live;
  const hypo = PERF.stats.portfolio_hypothetical || {};
  const isLive = live != null;
  const s = isLive ? live : hypo;
  const spx = PERF.stats.spx || {};

  const vs = (k, fmt) => (isLive && spx[k] != null ? { delta: `SPX ${fmt(spx[k])}` } : {});
  renderStats("tiles", [
    { label: isLive ? "CAGR (live)" : "CAGR (hypothetical)", value: fmtPct(s.cagr),
      tone: signClass(s.cagr),
      ...(isLive && spx.cagr != null
        ? { delta: `${s.cagr - spx.cagr >= 0 ? "+" : ""}${((s.cagr - spx.cagr) * 100).toFixed(1)}pp vs SPX`,
            deltaTone: signClass(s.cagr - spx.cagr) }
        : {}) },
    { label: "Volatility", value: fmtPct(s.vol),
      delta: `target ${PORT.vol_target_band.map((v) => fmtPct(v, 0)).join("–")}` },
    { label: "Sharpe", value: fmtNum(s.sharpe), ...vs("sharpe", (x) => x.toFixed(2)) },
    { label: "Max drawdown", value: fmtPct(s.max_dd), tone: "down", ...vs("max_dd", (x) => fmtPct(x)) },
    { label: "Positions", value: String(PORT.n_positions), delta: `model vol ${fmtPct(PORT.model_vol)}` },
  ]);

  const old = document.getElementById("hypo-note");
  if (old) old.remove();
  if (!isLive) {
    const d = PERF.hypothetical_disclosure || {};
    document.getElementById("tiles").insertAdjacentElement("afterend", el("p", {
      id: "hypo-note", class: "disclosure",
      text: "Hypothetical — not a track record. " + (d.basis || "") +
            ", so these figures are in-sample and are deliberately not compared to a benchmark." +
            (d.cost_model ? " Costs: " + d.cost_model + "." : ""),
    }));
  }
}

function renderPerf() {
  const labels = PERF.dates;
  const series = [
    { label: "Model", data: PERF.portfolio, color: tok("--s6"), order: 0, width: 2 },
    { label: "S&P 500", data: PERF.spx, color: tok("--ctx-1"), width: 1.5 },
    { label: "Nasdaq", data: PERF.comp, color: tok("--ctx-2"), width: 1.5 },
  ];
  buildLegend("perf-legend", series.map((s) => ({ label: s.label, color: s.color, shape: "line" })));
  draw("perf-chart", lineConfig({
    labels, series, yFmt: (v) => Math.round(v),
    plugins: [liveMarker(labels, PERF.live_start)],
  }));
  describeCanvas("perf-chart",
    `Growth of 100 from ${labels[0]} to ${labels[labels.length - 1]}. ` +
    `Shading marks the hypothetical period before ${PERF.live_start}.`);
  const d = PERF.hypothetical_disclosure || {};
  document.getElementById("perf-note").textContent =
    `Indexed to 100. Shaded region is hypothetical (${d.hypothetical_points ?? "?"} of ` +
    `${d.total_points ?? labels.length} points); live record starts ${PERF.live_start}.`;
}

function renderHoldings() {
  const rows = [...PORT.holdings].sort((a, b) => b.weight - a.weight).map((h) => ({
    ticker: h.ticker, sector: h.sector, weight: h.weight, alpha: h.alpha_score,
    value: h.signals?.value, quality: h.signals?.quality,
    momentum: h.signals?.momentum, short: h.signals?.short_interest,
    pe: h.raw?.pe,
  }));
  const order = rows.map((r) => r.ticker);
  const sig = (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2));
  const sigCls = (k) => (r) => (r[k] > 0.5 ? "pos" : r[k] < -0.5 ? "neg" : "");

  renderTable(document.getElementById("holdings-table"), rows, [
    { key: "ticker", label: "Ticker", fmt: (v) => el("span", {}, [
        el("span", { class: "dot", style: `background:${slotColor(order.indexOf(v))}` }),
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

  const pending = PORT.pending && Object.keys(PORT.pending).length
    ? ` ${Object.keys(PORT.pending).length} name(s) seasoning and held out.` : "";
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
       equal-weight vol ${fmtPct(RISK.eq_weight_vol)}.` : "Risk diagnostics unavailable."}</p>
    <h3>Construction</h3>
    <p>Long-only, fully invested, max ${fmtPct(PORT.max_weight, 0)} per name, targeting the
    ${PORT.vol_target_band.map((v) => fmtPct(v, 0)).join("–")} volatility band
    (${PORT.vol_band_met ? "met" : "not met"} this run at ${fmtPct(PORT.model_vol)};
    long-only minimum-variance is ${fmtPct(PORT.min_var_vol)}).</p>`;
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
