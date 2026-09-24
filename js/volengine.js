/* The vol engine page: reads docs/data/vol_engine.json only. */
import { loadJSON, showError, fmtPct, fmtNum, el, renderStats, renderTable, signed, signClass, tok, alpha, slotColors, buildLegend } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";
import { draw, lineConfig, applyChartDefaults } from "./charts.js";

let D = null;
const pct = (x, dp = 1) => (x == null ? "—" : fmtPct(x, dp));
const num = (x, dp = 2) => (x == null || Number.isNaN(x) ? "—" : fmtNum(x, dp));

function header() {
  const f = D.forecast, e = f.evaluation, r = D.realised, s = D.implied;
  document.getElementById("ve-meta").textContent =
    `${D.underlying} ${num(D.spot)} · bars to ${D.as_of} · race ${e.since} → ${e.until}, ${e.n.toLocaleString()} forecasts` +
    (s ? ` · surface snapshot ${s.as_of.replace("T", " ").slice(0, 16)} (${s.source}${s.delayed_min ? `, ${s.delayed_min} min delayed` : ", real-time"})` : "");
  const win = e.models[e.winner];
  renderStats("ve-strip", [
    { label: "Realised 21d, Yang-Zhang", value: pct(r.now_21.yang_zhang), delta: `close-to-close ${pct(r.now_21.close_close)} · percentile ${num(r.cone["21"]?.percentile, 2)}` },
    { label: `Forecast 21d · ${f.model}`, value: pct(f.now_chosen), delta: `${f.labels[f.model]} · QLIKE ${num(win.qlike, 3)}`, tone: "book" },
    { label: "VIX", value: pct(f.vix_now), delta: `implied − forecast ${signed((f.vix_now - f.now_chosen) * 100, 1)} pts`, tone: f.vix_now > f.now_chosen ? "up" : "down" },
    { label: "Model-free 30d", value: s ? pct(s.mfiv.d30?.sigma) : "—", delta: s ? `vs VIX ${num(s.mfiv.vix_close)} on ${s.mfiv.vix_date}` : "no snapshot" },
    { label: "Variance premium, mean", value: `${signed(D.vrp.mean_vol_pts, 2)} pts`, delta: `positive ${pct(D.vrp.p_positive, 0)} of months since ${D.vrp.since.slice(0, 4)}` },
    { label: "Roughness H", value: `${num(D.rough.gk_daily?.H, 2)} – ${num(D.rough.vix?.H, 2)}`, delta: "range vs VIX bounds · diffusion = 0.50" },
    { label: "VIX half-life", value: `${num(D.ou?.half_life_days, 0)} d`, delta: `κ ${num(D.ou?.kappa_per_year, 1)}/yr · long-run ${pct(D.ou?.theta_level, 0)}` },
  ]);
}

function race() {
  const e = D.forecast.evaluation, L = D.forecast.labels;
  document.getElementById("ve-race-note").textContent = `winner by QLIKE: ${L[e.winner]} · benchmark ${L[e.benchmark]}`;
  const rows = Object.entries(e.models).map(([m, r]) => ({ m, model: L[m], q: r.qlike, mse: r.mse, mae: r.mae_vol, bias: r.bias_vol, b: r.mz_beta, r2: r.mz_r2,
    dmb: r.dm_vs_benchmark, dmw: r.dm_vs_winner, calm: r.qlike_calm, stress: r.qlike_stress, win: m === e.winner, live: m === D.forecast.model }));
  renderTable(document.getElementById("ve-race"), rows, [
    { key: "model", label: "Forecaster", fmt: (v, r) => el("span", {}, [el("span", { class: r.win ? "sym" : "", text: v }), r.live ? el("span", { class: "pill on", style: "margin-left:8px", text: "strategy" }) : null]) },
    { key: "q", label: "QLIKE", num: true, cls: (r) => (r.win ? "up" : ""), fmt: (v) => num(v, 4) },
    { key: "mse", label: "MSE ×1e4", num: true, fmt: (v) => num(v, 2) },
    { key: "mae", label: "MAE, pts", num: true, fmt: (v) => num(v * 100, 2) },
    { key: "bias", label: "Bias, pts", num: true, fmt: (v) => signed(v * 100, 2) },
    { key: "b", label: "MZ slope", num: true, fmt: (v) => num(v, 2) }, { key: "r2", label: "MZ R²", num: true, fmt: (v) => num(v, 2) },
    { key: "dmb", label: "DM vs EWMA", num: true, cls: (r) => signClass(Math.abs(r.dmb) >= 3 ? -r.dmb : 0), fmt: (v) => signed(v, 2) },
    { key: "dmw", label: "DM vs winner", num: true, cls: (r) => signClass(Math.abs(r.dmw) >= 3 ? -r.dmw : 0), fmt: (v) => signed(v, 2) },
    { key: "calm", label: "QLIKE calm", num: true, fmt: (v) => num(v, 3) }, { key: "stress", label: "QLIKE VIX≥25", num: true, fmt: (v) => num(v, 3) },
  ], { sortKey: "q", dir: 1 });
  document.getElementById("ve-race-method").textContent = e.note + ` Green DM: the row beats the column at |DM| ≥ 3; red: it loses.`;
  const s = D.forecast.series;
  const keys = ["target", D.forecast.model, "gjr", "har", "vix"].filter((k, i, a) => a.indexOf(k) === i && s[k]);
  const colors = slotColors(keys.length);
  draw("ve-fc", lineConfig({ labels: s.dates, series: keys.map((k, i) => ({ label: k === "target" ? "realised (next 21d)" : L[k] || k, color: k === "target" ? tok("--ink") : colors[i], data: s[k], width: k === "target" ? 2.2 : 1.4 })),
    yFmt: (v) => pct(v, 0) }));
  buildLegend("ve-fc-legend", keys.map((k, i) => ({ label: k === "target" ? "realised" : L[k] || k, color: k === "target" ? tok("--ink") : colors[i], shape: "line" })));
  const ys = Object.entries(e.by_year).map(([y, v]) => ({ y: +y, ...v }));
  const ms = Object.keys(e.models);
  renderTable(document.getElementById("ve-years"), ys, [{ key: "y", label: "Year", num: true },
    ...ms.map((m) => ({ key: m, label: L[m].split(":")[0].split(" on ")[0], num: true, cls: (r) => (Math.min(...ms.map((k) => r[k] ?? 9)) === r[m] ? "up" : ""), fmt: (v) => num(v, 3) }))], { sortKey: "y", dir: 1 });
}

function realised() {
  const r = D.realised;
  const LAB = { close_close: "Close-to-close", parkinson: "Parkinson", garman_klass: "Garman-Klass", rogers_satchell: "Rogers-Satchell", yang_zhang: "Yang-Zhang" };
  renderTable(document.getElementById("ve-est"), Object.keys(r.now_21).map((k) => ({ est: LAB[k], d21: r.now_21[k], d63: r.now_63[k] })), [
    { key: "est", label: "Estimator" }, { key: "d21", label: "21d", num: true, fmt: (v) => pct(v) }, { key: "d63", label: "63d", num: true, fmt: (v) => pct(v) }]);
  renderTable(document.getElementById("ve-cone"), Object.entries(r.cone).map(([w, c]) => ({ w: +w, ...c })), [
    { key: "w", label: "Window", num: true, fmt: (v) => `${v}d` }, { key: "now", label: "Now", num: true, fmt: (v) => pct(v) },
    { key: "p5", label: "5%", num: true, fmt: (v) => pct(v, 0) }, { key: "p25", label: "25%", num: true, fmt: (v) => pct(v, 0) },
    { key: "p50", label: "50%", num: true, fmt: (v) => pct(v, 0) }, { key: "p75", label: "75%", num: true, fmt: (v) => pct(v, 0) },
    { key: "p95", label: "95%", num: true, fmt: (v) => pct(v, 0) }, { key: "percentile", label: "Percentile", num: true, cls: (x) => (x.percentile < 0.2 ? "down" : x.percentile > 0.8 ? "up" : ""), fmt: (v) => num(v, 2) },
  ], { sortKey: "w", dir: 1 });
  const h = r.history, c = slotColors(3);
  draw("ve-hist", lineConfig({ labels: h.dates, series: [{ label: "VIX", color: c[2], data: h.vix, width: 1.4 }, { label: "realised 21d, close-to-close", color: c[0], data: h.cc21 }, { label: "realised 21d, Yang-Zhang", color: c[1], data: h.yz21, dash: [4, 3], width: 1.4 }], yFmt: (v) => pct(v, 0) }));
  buildLegend("ve-hist-legend", [{ label: "VIX", color: c[2], shape: "line" }, { label: "close-to-close 21d", color: c[0], shape: "line" }, { label: "Yang-Zhang 21d", color: c[1], shape: "line" }]);
  const v = D.vrp;
  renderStats("ve-vrp", [
    { label: "VRP, variance ×1e4", value: `${signed(v.mean, 0)}`, delta: `median ${signed(v.median, 0)} · ${v.n.toLocaleString()} days since ${v.since}` },
    { label: "In vol points", value: `${signed(v.mean_vol_pts, 2)}`, delta: "VIX less the vol then realised, 21 days" },
    { label: "Last 3 years", value: `${signed(v.last_3y_mean, 0)}`, delta: `worst ${signed(v.worst, 0)} on ${v.worst_date}`, tone: v.last_3y_mean > 0 ? "up" : "down" },
  ]);
}

function svi() {
  const s = D.implied; const sel = document.getElementById("ve-exp");
  if (!s) { document.getElementById("ve-svi-note").textContent = "no option snapshot within three days"; return; }
  const fit = s.svi;
  document.getElementById("ve-svi-note").textContent = `${fit.slices.length} expiries · butterfly ${fit.butterfly_ok ? "free" : "VIOLATED"} · calendar ${fit.calendar_ok ? "free" : `violated between ${fit.calendar.filter((c) => !c.ok).map((c) => c.pair[1]).join(", ")}`}`;
  if (!sel.querySelectorAll("option").length) {
    for (const x of fit.slices) sel.appendChild(el("option", { value: x.expiry, text: `${x.expiry} · ${x.dte}d · ${x.n} quotes` }));
    sel.value = (fit.slices.reduce((b, x) => (Math.abs(x.dte - 30) < Math.abs(b.dte - 30) ? x : b), fit.slices[0])).expiry;
    sel.onchange = svi;
  }
  const x = fit.slices.find((z) => z.expiry === sel.value) || fit.slices[0];
  const c = slotColors(2);
  draw("ve-smile", { type: "scatter",
    data: { datasets: [
      { label: "SVI", type: "line", data: x.curve.map((p) => ({ x: p.k, y: p.iv })), borderColor: c[0], borderWidth: 2, pointRadius: 0, tension: 0.2, order: 2 },
      { label: "market", data: x.market.map((p) => ({ x: p.k, y: p.iv })), backgroundColor: c[1], pointRadius: 2.5, order: 1 } ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "nearest", intersect: false },
      scales: { x: { type: "linear", grid: { display: false }, border: { color: tok("--baseline") }, ticks: { callback: (v) => Number(v).toFixed(2) }, title: { display: true, text: "log(K / F)", color: tok("--muted") } },
                y: { grid: { color: tok("--grid") }, border: { display: false }, ticks: { callback: (v) => pct(v, 0) } } },
      plugins: { tooltip: { callbacks: { label: (t) => ` ${t.dataset.label}: k ${t.parsed.x.toFixed(3)} · ${pct(t.parsed.y, 2)}` } } } } });
  buildLegend("ve-smile-legend", [{ label: `SVI fit, ${x.expiry}`, color: c[0], shape: "line" }, { label: "market IV", color: c[1] }]);
  const d = x.density;
  if (d) {
    draw("ve-dens", { type: "line",
      data: { labels: d.strikes, datasets: [{ label: "risk-neutral density", data: d.pdf, borderColor: c[0], borderWidth: 2, pointRadius: 0, fill: true, backgroundColor: alpha(c[0], 0.15), tension: 0.2 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        scales: { x: { grid: { display: false }, border: { color: tok("--baseline") }, ticks: { maxTicksLimit: 8, callback: (v) => num(d.strikes[v], 0) } }, y: { display: false } },
        plugins: { tooltip: { callbacks: { title: (it) => `strike ${num(d.strikes[it[0].dataIndex], 0)}`, label: () => "" } } } } });
    document.getElementById("ve-dens-note").textContent = `Q-density to ${x.expiry}: skew ${signed(d.skew, 2)}, kurtosis ${num(d.kurtosis, 1)}, 1σ move ${pct(d.sd_logret)}, P(< −10%) ${pct(d.p_below_90)}, P(> +10%) ${pct(d.p_above_110)}, mass ${num(d.mass, 3)}`;
  }
  renderTable(document.getElementById("ve-svi"), fit.slices.map((z) => ({ ...z, rho: z.params.rho, b: z.params.b, sig: z.params.sigma, skew: z.density?.skew, kurt: z.density?.kurtosis, pd: z.density?.p_below_90, pu: z.density?.p_above_110, sd: z.density?.sd_logret })), [
    { key: "expiry", label: "Expiry" }, { key: "dte", label: "Days", num: true }, { key: "n", label: "Quotes", num: true },
    { key: "rmse_vol", label: "RMSE, pts", num: true, fmt: (v) => num(v * 100, 2) }, { key: "atm_iv", label: "ATM", num: true, fmt: (v) => pct(v) },
    { key: "rho", label: "ρ", num: true, fmt: (v) => signed(v, 2) }, { key: "b", label: "b", num: true, fmt: (v) => num(v, 3) },
    { key: "butterfly_min_g", label: "min g", num: true, cls: (r) => (r.butterfly_ok ? "" : "down"), fmt: (v) => signed(v, 3) },
    { key: "skew", label: "Q-skew", num: true, fmt: (v) => signed(v, 2) }, { key: "kurt", label: "Q-kurt", num: true, fmt: (v) => num(v, 1) },
    { key: "sd", label: "1σ move", num: true, fmt: (v) => pct(v) }, { key: "pd", label: "P(<−10%)", num: true, fmt: (v) => pct(v) }, { key: "pu", label: "P(>+10%)", num: true, fmt: (v) => pct(v) },
  ], { sortKey: "dte", dir: 1 });
}

function mfiv() {
  const s = D.implied; if (!s) return;
  const m = s.mfiv;
  renderStats("ve-mfiv", [
    { label: "30 days", value: pct(m.d30?.sigma, 2), delta: `VIX ${num(m.vix_close)} · gap ${signed(m.gap_30_vs_vix, 2)}` },
    { label: "60 days", value: pct(m.d60?.sigma, 2), delta: "interpolated in total variance" },
    { label: "90 days", value: pct(m.d90?.sigma, 2), delta: `VIX3M ${num(m.vix3m_close)}` },
  ]);
  renderTable(document.getElementById("ve-mfiv-table"), m.per_expiry, [
    { key: "expiry", label: "Expiry" }, { key: "dte", label: "Days", num: true }, { key: "sigma", label: "σ", num: true, fmt: (v) => pct(v, 2) },
    { key: "F", label: "Forward", num: true, fmt: (v) => num(v, 2) }, { key: "n_strikes", label: "Strikes", num: true },
    { key: "k_low", label: "Lowest", num: true, fmt: (v) => signed(v * 100, 0) + "%" }, { key: "k_high", label: "Highest", num: true, fmt: (v) => signed(v * 100, 0) + "%" },
  ], { sortKey: "dte", dir: 1 });
  document.getElementById("ve-mfiv-note").textContent = m.note;
}

function roughness() {
  const r = D.rough, o = D.ou, d = D.spike_decay;
  renderStats("ve-rough", [
    { label: "H, one-day range vol", value: num(r.gk_daily?.H, 3), delta: "lower bound: measurement noise reads rough" },
    { label: "H, log VIX", value: num(r.vix?.H, 3), delta: `upper bound: smoothed · R² ${num(r.vix?.r2, 3)}` },
    { label: "Literature, 5-min RV", value: "≈ 0.10", delta: "Gatheral, Jaisson & Rosenbaum 2018" },
    { label: "κ, log VIX", value: `${num(o?.kappa_per_year, 2)}/yr`, delta: `half-life ${num(o?.half_life_days, 0)} days` },
    { label: "Long-run VIX", value: pct(o?.theta_level, 1), delta: `vol of log VIX ${num(o?.sigma_annual, 2)}/yr` },
  ]);
  if (d) {
    const labels = d.mean_path.map((_, i) => i);
    const c = slotColors(2);
    draw("ve-decay", lineConfig({ labels, series: [{ label: "mean", color: c[0], data: d.mean_path }, { label: "median", color: c[1], data: d.median_path, dash: [4, 3] }], yFmt: (v) => num(v, 2) }));
    const ch = document.getElementById("ve-decay"); // x labels are day counts, not dates
    document.getElementById("ve-decay-note").textContent = `VIX after it first closes above ${d.threshold}: ${d.n_episodes} episodes since 1990, as a fraction of the spike day, over 63 trading days` + (d.days_to_half ? ` · the mean path halves after ${d.days_to_half} days` : " · the mean path has not halved within 63 days");
  }
  document.getElementById("ve-rough-note").textContent = r.note;
}

async function init() {
  renderShell(); applyChartDefaults();
  try {
    D = await loadJSON("data/vol_engine.json");
    setAsOf(D.as_of);
    header(); race(); realised(); svi(); mfiv(); roughness();
    document.getElementById("ve-caveat").textContent = D.caveat;
    window.addEventListener("themechange", () => { applyChartDefaults(); race(); realised(); svi(); roughness(); });
  } catch (err) { showError(document.getElementById("error"), err); throw err; }
}
init();
