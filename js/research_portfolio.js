/* Model target allocation + sector exposure. */

import {
  loadJSON, showError, fmtPct, fmtNum, tok, slotColor, el, renderStats, buildLegend,
  renderTable,
} from "./common.js";
import { applyChartDefaults, draw, doughnutConfig, hbarConfig, describeCanvas } from "./charts.js";
import { renderShell, setAsOf, onThemeChange, registerCommands } from "./shell.js";

let PORT = null, RISK = null;
const sectorSlots = new Map();   // fixed by first appearance, never cycled
const sectorColor = (s) => {
  if (!sectorSlots.has(s)) sectorSlots.set(s, sectorSlots.size);
  return slotColor(sectorSlots.get(s));
};

function renderAll() {
  applyChartDefaults();
  const hold = [...PORT.holdings].sort((a, b) => b.weight - a.weight);

  renderStats("tiles", [
    { label: "Positions", value: String(PORT.n_positions) },
    { label: "Model volatility", value: fmtPct(PORT.model_vol),
      delta: PORT.vol_band_met ? "inside target band" : "outside band",
      deltaTone: PORT.vol_band_met ? "up" : "down" },
    { label: "Vol target", value: PORT.vol_target_band.map((v) => fmtPct(v, 0)).join("–") },
    { label: "Max position", value: fmtPct(PORT.max_weight, 0) },
    { label: "Min-var vol", value: fmtPct(PORT.min_var_vol) },
  ]);

  const labels = hold.map((h) => h.ticker);
  const values = hold.map((h) => +(h.weight * 100).toFixed(2));
  const colors = hold.map((h) => sectorColor(h.sector));
  buildLegend("alloc-legend",
    [...sectorSlots.keys()].map((s) => ({ label: s, color: sectorColor(s), shape: "rect" })));
  draw("alloc-chart", doughnutConfig({
    labels, values, colors,
    fmt: (v) => v.toFixed(2) + "%",
  }));
  describeCanvas("alloc-chart",
    `Target allocation: ${labels.map((l, i) => `${l} ${values[i]}%`).join(", ")}.`);

  const bySector = new Map();
  for (const h of hold) bySector.set(h.sector, (bySector.get(h.sector) || 0) + h.weight);
  const secs = [...bySector.entries()].sort((a, b) => b[1] - a[1]);
  document.getElementById("sector-box").style.height = `${40 + secs.length * 26}px`;
  draw("sector-chart", hbarConfig({
    labels: secs.map((s) => s[0]),
    values: secs.map((s) => +(s[1] * 100).toFixed(2)),
    colors: secs.map((s) => sectorColor(s[0])),
    valueLabels: secs.map((s) => (s[1] * 100).toFixed(1) + "%"),
  }));
  describeCanvas("sector-chart",
    `Sector exposure: ${secs.map(([s, w]) => `${s} ${(w * 100).toFixed(1)}%`).join(", ")}.`);
  document.getElementById("sector-note").textContent =
    PORT.sector_neutral ? "Signals are neutralised within GICS sector before ranking." : "";

  modelInputs();
  expectedReturns();
  constraints();
}

/* How mu and Sigma were built (ADDENDUM 7.0 / 7.1 / 7.8). */
function modelInputs() {
  const er = PORT.expected_returns;
  const strip = document.getElementById("inputs-strip");
  const note = document.getElementById("inputs-note");
  if (!er || !strip) return;

  const vf = RISK?.vol_forecast, cx = RISK?.complexity;
  const ratio = vf?.forecast_vs_trailing?.median;
  renderStats("inputs-strip", [
    { label: "Expected returns", value: er.model === "black_litterman" ? "Black-Litterman" : "Legacy",
      delta: er.n_views != null ? `${er.n_views} views` : "" },
    { label: "Risk aversion", value: er.risk_aversion?.toFixed(2) ?? "—",
      delta: er.universe_beta != null
        ? `beta ${er.universe_beta.toFixed(2)} x ERP ${fmtPct(er.erp_forward, 1)}` : "" },
    { label: "Vol forecast", value: (vf?.method || "—").toUpperCase(),
      delta: ratio != null ? `${ratio.toFixed(2)}x trailing` : "",
      deltaTone: ratio != null && ratio < 1 ? "up" : "" },
    { label: "Shrinkage intensity", value: cx ? cx.shrinkage_intensity.toFixed(3) : "—",
      delta: cx ? `N/T ${cx.n_over_t.toFixed(2)}` : "",
      deltaTone: cx && cx.warning ? "down" : "up" },
    { label: "Prior / posterior", value: er.prior_posterior_corr?.toFixed(3) ?? "—",
      delta: "correlation" },
  ]);

  const bits = [];
  if (vf) {
    bits.push(
      `Volatility is forecast (${vf.method}${vf.method === "ewma"
        ? `, lambda ${vf.ewma_lambda}` : ""}) rather than read off trailing 252-day realized ` +
      `vol, and the risk model's correlations are kept while its diagonal is replaced. ` +
      (vf.implied_available
        ? `Blended with an option surface for ${vf.names_blended_with_implied.length} names.`
        : `No option surface is wired in, so the blend degrades to the model forecast — ` +
          `never back to trailing vol.`));
  }
  if (cx) {
    bits.push(cx.warning
      || `Ledoit-Wolf shrinkage intensity ${cx.shrinkage_intensity.toFixed(2)} at N/T ` +
         `${cx.n_over_t.toFixed(2)} — the sample covariance is well supported by the data, ` +
         `so estimation risk is not the binding issue at this number of holdings.`);
  }
  note.textContent = bits.join(" ");
}

/* Per-name equilibrium prior against the signal view.

   The prior is what the market's own cap weights imply the name should return;
   the view is the signal's disagreement, scaled by IC and the name's forecast
   vol. Showing them apart is the point of the layer — a large weight sitting on
   a large prior is the market's opinion, not ours. */
function expectedReturns() {
  const er = PORT.expected_returns;
  const table = document.getElementById("er-table");
  if (!table || !er?.per_name) return;
  const held = new Map(PORT.holdings.map((h) => [h.ticker, h.weight]));

  const rows = Object.entries(er.per_name).map(([symbol, r]) => ({
    symbol, ...r, weight: held.get(symbol) ?? 0,
  }));

  renderTable(table, rows, [
    { key: "symbol", label: "Name",
      fmt: (v, r) => el("span", { class: "sym" + (r.weight ? "" : " muted"), text: v }) },
    { key: "weight", label: "Weight", num: true,
      fmt: (v) => (v ? fmtPct(v, 2) : "—") },
    { key: "mkt_weight", label: "Cap weight", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "prior", label: "Equilibrium", num: true,
      cls: (r) => (r.prior < 0 ? "neg" : ""), fmt: (v) => fmtPct(v, 2) },
    { key: "view", label: "View", num: true,
      cls: (r) => (r.view > 0 ? "pos" : r.view < 0 ? "neg" : ""),
      fmt: (v) => (v == null ? "—" : fmtPct(v, 2)) },
    { key: "mu", label: "Posterior", num: true, fmt: (v) => fmtPct(v, 2) },
  ], { sortKey: "mu", dir: -1 });

  document.getElementById("er-note").textContent =
    `Equilibrium is lambda x Sigma x w_cap — the return the market's own weights imply, ` +
    `not a historical average. View is IC x forecast vol x signal z-score, so a view on a ` +
    `volatile name is sized larger in return terms than the same rank on a stable one. ` +
    `Posterior is the Black-Litterman blend; it reverts to the prior wherever no view ` +
    `exists. A negative equilibrium return means the name hedges the cap-weighted ` +
    `universe, which is a reason to hold it, not to avoid it.`;
}

/* The constraint set, shown because a weight sitting exactly on a limit is an
   artefact of the limit rather than a statement of conviction, and the two are
   indistinguishable from the allocation chart alone. */
function constraints() {
  const c = PORT.constraints;
  const strip = document.getElementById("cons-strip");
  const detail = document.getElementById("cons-detail");
  const note = document.getElementById("cons-note");
  if (!c) { [strip, detail, note].forEach((n) => n && n.remove()); return; }

  const secCaps = Object.entries(c.sector_caps || {});
  renderStats("cons-strip", [
    { label: "Minimum positions", value: String(c.min_positions ?? "—"),
      delta: `${PORT.n_positions} held`,
      deltaTone: PORT.n_positions >= (c.min_positions ?? 0) ? "up" : "down" },
    { label: "Max position", value: fmtPct(c.max_weight, 0) },
    { label: "One-way turnover", value: fmtPct(c.turnover_one_way, 1) },
    { label: "Names at their cap", value: String((c.names_at_cap || []).length),
      delta: (c.names_at_cap || []).join(", ") || "none" },
  ]);

  const rows = [];
  for (const [sector, cap] of secCaps) {
    const used = c.sector_weights?.[sector] ?? 0;
    rows.push({ what: `${sector} budget`, limit: fmtPct(cap, 0), used: fmtPct(used, 2),
      binding: Math.abs(used - cap) < 1e-4 });
  }
  for (const [name, cap] of Object.entries(c.name_caps || {})) {
    const w = PORT.holdings.find((h) => h.ticker === name)?.weight ?? 0;
    rows.push({ what: `${name} cap`, limit: fmtPct(cap, 0), used: fmtPct(w, 2),
      binding: Math.abs(w - cap) < 1e-4 });
  }
  for (const name of c.must_hold || []) {
    const w = PORT.holdings.find((h) => h.ticker === name)?.weight ?? 0;
    rows.push({ what: `${name} floor`, limit: fmtPct(c.must_hold_min, 0), used: fmtPct(w, 2),
      binding: Math.abs(w - c.must_hold_min) < 1e-4 });
  }

  detail.replaceChildren(...rows.map((r) => el("div", { class: "cons-row" }, [
    el("span", { text: r.what }),
    el("span", { class: "num", text: r.used }),
    el("span", { class: "num muted", text: `of ${r.limit}` }),
    el("span", { class: "pill" + (r.binding ? " warn" : ""),
      text: r.binding ? "binding" : "slack" }),
  ])));

  const binding = rows.filter((r) => r.binding).map((r) => r.what);
  note.textContent =
    `A binding constraint means the optimizer wanted to go further and was stopped, so ` +
    `that weight reflects the rule rather than the signal. ` +
    (binding.length ? `Currently binding: ${binding.join("; ")}.` : "Nothing is binding.") +
    ` Must-hold names are imposed convictions — the optimizer sizes them but cannot drop them.`;
}

(async function init() {
  renderShell();
  const content = document.getElementById("content");
  try { PORT = await loadJSON("data/portfolio.json"); }
  catch (err) { showError(content, err); return; }
  // Non-fatal: the risk artifact is separate, and every other panel must render
  // without it.
  RISK = await loadJSON("data/risk.json").catch(() => null);
  setAsOf(PORT.as_of);
  registerCommands(PORT.holdings.map((h) => ({ key: h.ticker, hint: h.sector })));
  renderAll();
  onThemeChange(renderAll);
})();
