/* The rendering a book page does, parameterised by a book spec.

   This file knows how to draw an overview, an analytics page and an activity
   log. It does NOT know which book it is drawing: every difference between the
   two books — what they are measured against, what they are managed toward,
   which panels apply — arrives in the `spec` from books/usd.js or books/cad.js.

   The previous version branched on `document.querySelector("main").dataset.book`
   in six places, which is how the CAD book ended up with a "Model target"
   toggle that loaded the USD model's numbers. */

import { ticker, crosshair, sparkline } from "../terminal.js";
import {
  loadJSON, showError, fmtPct, fmtNum, fmtSigned, fmtDate, signClass,
  tok, alpha, slotColor, breakdownColors, el, renderStats, buildLegend, renderTable,
  normActivity, ACTIVITY_PENDING,
} from "../common.js";
import {
  applyChartDefaults, draw, lineConfig, doughnutConfig, describeCanvas, crosshair,
} from "../charts.js";
import { renderShell, setAsOf, onThemeChange, registerCommands } from "../shell.js";

const pct = (x, dp = 1) => fmtPct(x, dp);

async function loadBook(spec) {
  const PF = await loadJSON("data/current_portfolio.json");
  const B = PF.books[spec.key];
  if (!B) throw new Error(`no ${spec.key} book in current_portfolio.json`);
  return { PF, B };
}

/* ------------------------------------------------------------------ overview */

export async function overview(spec) {
  renderShell();
  let PF, B;
  try { ({ PF, B } = await loadBook(spec)); }
  catch (err) { showError(document.getElementById("error"), err); return; }

  const s = await Promise.allSettled([
    loadJSON(`data/metrics_${spec.key}.json`), loadJSON("data/book_history.json"),
    loadJSON(`data/transactions_${spec.key}.json`),
  ]);
  const v = (i) => (s[i].status === "fulfilled" ? s[i].value : null);
  const MET = v(0), HIST = v(1), TX = v(2);
  const positions = () => [...B.positions].sort((a, b) => b.weight - a.weight);

  setAsOf(PF.as_of);
  document.getElementById("book-eyebrow").textContent =
    `${B.currency} · ${spec.runBy} · benchmark ${B.benchmark}`;
  document.getElementById("book-title").textContent = B.label;
  document.getElementById("book-mandate").textContent = B.mandate;

  function stats() {
    const rows = positions(), top = rows[0];
    const stale = rows.filter((p) => p.stale_price);
    const outside = rows.filter((p) => p.in_model === false);
    renderStats("stats", [
      { label: "Positions", value: String(rows.length), delta: top ? `${top.symbol} largest ${fmtPct(top.weight)}` : null },
      { label: "Cash", value: fmtPct(B.cash_weight, 1), delta: "of total equity" },
      { label: "Share of both books", value: fmtPct(B.share_of_total, 0), delta: "combined value" },
      MET ? { label: `Beta vs ${MET.benchmark}`, value: fmtNum(MET.beta),
              delta: `down ${fmtNum(MET.beta_down)} · up ${fmtNum(MET.beta_up)}` } : null,
      MET ? { label: "Volatility", value: fmtPct(MET.vol_annual), delta: "3y, current weights" } : null,
      MET ? { label: "Max drawdown", value: fmtPct(MET.max_drawdown), tone: "down", delta: "3y, hypothetical" } : null,
      { label: spec.driftLabel, value: fmtPct(B.drift_one_way, 1),
        tone: spec.driftTone(B.drift_one_way),
        delta: `one-way, ${Object.keys(B.target || {}).length} names` },
      outside.length ? { label: "Outside the model", value: String(outside.length), tone: "down",
                         delta: outside.map((p) => p.symbol).join(", ") } : null,
      stale.length ? { label: "Stale prices", value: String(stale.length), tone: "down",
                       delta: stale.map((p) => p.symbol).join(", ") } : null,
    ]);
  }

  function value() {
    const pts = HIST?.books?.[spec.key] || [];
    const meta = document.getElementById("value-meta"), note = document.getElementById("value-note");
    if (pts.length < 2) {
      document.querySelector("#value-chart").closest(".chart").hidden = true;
      meta.textContent = pts[0] ? `index starts ${fmtDate(pts[0].date)}` : "";
      note.textContent = "The account was split into two books on 2026-09-21. This book's value index " +
        "starts at 100 that day and gains a point with every daily sync; a line needs two of them.";
      return;
    }
    const labels = pts.map((p) => p.date);
    const idx = pts.map((p) => p.value_index);
    const series = [{ label: B.label, data: idx, color: tok(`--${spec.key}`) }];
    buildLegend("value-legend", series.map((x) => ({ label: x.label, color: x.color, shape: "line" })));
    const chart = draw("value-chart", lineConfig({ labels, series, yFmt: (x) => x.toFixed(1) }));
    crosshair(document.getElementById("value-chart"), chart, (v) => v.toFixed(2));
    describeCanvas("value-chart", `${B.label} value index, ${pts.length} daily points since ${pts[0].date}.`);
    const last = pts[pts.length - 1];
    //: The quote header. A book is read the way a symbol is read: what it is,
    //: where it stands, how far it has moved — before any of the panels below.
    ticker(document.getElementById("book-ticker"), {
      symbol: spec.key.toUpperCase(),
      name: B.label,
      value: last.value_index,
      valueFmt: (v) => fmtNum(v, 2),
      change: last.value_index / 100 - 1,
      meta: [
        ["Since", fmtDate(pts[0].date)],
        ["Points", String(pts.length)],
        ["Benchmark", (MET && MET.benchmark) || "—"],
        ["Names", String(Object.keys(B.target || {}).length)],
      ],
    });
    meta.textContent = `${fmtSigned(last.value_index / 100 - 1)} since ${fmtDate(pts[0].date)}`;
    note.textContent = "Equity in the book's own currency, indexed to 100 at the split. Contributions move " +
      "it too; a time-weighted line follows once the activity log fills in.";
  }

  function allocation() {
    const rows = positions();
    const labels = rows.map((p) => p.symbol);
    const values = rows.map((p) => +(p.weight * 100).toFixed(2));
    const colors = breakdownColors(rows.length);
    draw("alloc-chart", doughnutConfig({ labels, values, colors }));
    describeCanvas("alloc-chart", `Allocation across ${rows.length} positions: ` +
      labels.map((l, i) => `${l} ${values[i]}%`).join(", ") + ".");
    const host = document.getElementById("alloc-breakdown");
    const max = values[0] || 1;
    host.innerHTML = "";
    rows.forEach((p, i) => {
      host.appendChild(el("div", { class: "alloc-row" }, [
        el("span", { class: "dot", style: `background:${colors[i]}` }),
        el("span", { class: "sym", text: p.symbol }),
        el("span", { class: "meter" }, [el("i", { style: `width:${(values[i] / max * 100).toFixed(1)}%;background:${colors[i]}` })]),
        el("span", { class: "num", text: fmtPct(p.weight, 2) }),
      ]));
    });
    host.appendChild(el("div", { class: "alloc-row total" }, [
      el("span", {}), el("span", { text: `${rows.length} positions` }), el("span", {}),
      el("span", { class: "num", text: fmtPct(values.reduce((a, b) => a + b, 0) / 100, 2) }),
    ]));
  }

  function table() {
    const rows = positions();
    const order = rows.map((r) => r.symbol);
    const colors = breakdownColors(rows.length);
    renderTable(document.getElementById("pos-table"), rows.map((p) => ({
      symbol: p.symbol, name: p.name || "", weight: p.weight,
      ret: p.return_pct ?? null, in_model: p.in_model, stale: !!p.stale_price,
    })), [
      { key: "symbol", label: "Symbol", fmt: (v2) => el("span", {}, [
          el("span", { class: "dot", style: `background:${colors[order.indexOf(v2)]}` }),
          el("span", { class: "sym", text: v2 })]) },
      { key: "name", label: "Name", fmt: (v2) => el("span", { class: "muted", text: v2 }) },
      { key: "weight", label: "Weight", num: true, fmt: (v2) => fmtPct(v2, 2) },
      { key: "ret", label: "Since entry", num: true, cls: (r) => (r.ret > 0 ? "pos" : r.ret < 0 ? "neg" : ""),
        fmt: (v2) => (v2 == null ? "—" : fmtSigned(v2, 1)) },
      ...(spec.showModelColumn ? [{ key: "in_model", label: "Model", fmt: (v2) =>
          v2 ? el("span", { class: "pill book", text: "in model" })
             : el("span", { class: "pill warn", text: "outside model" }) }] : []),
      { key: "stale", label: "Price", fmt: (v2) => v2
          ? el("span", { class: "pill warn", text: "book cost" })
          : el("span", { class: "note", text: "live" }) },
    ], { sortKey: "weight", dir: -1 });
    document.getElementById("pos-count").textContent = `${rows.length} positions · weights within this book`;
  }

  /* Held against what the book is managed toward. Both the target and the
     sentence explaining a gap come from the book's Python module, so the
     page reports the rule rather than inventing one. */
  function drift() {
    const rows = positions();
    const target = B.target || {};
    document.getElementById("drift-title").textContent = spec.driftTitle;
    document.getElementById("drift-meta").textContent = spec.driftMeta(B);
    const held = new Map(rows.map((p) => [p.symbol, p.weight]));
    const byUsd = new Map((PF.usd_positions || []).map((u) => [u.symbol, u.weight]));
    const names = new Set([...held.keys(), ...Object.keys(target)]);
    const out = [...names].map((sym) => {
      const h = held.get(sym) ?? (spec.key === "usd" ? byUsd.get(sym) : undefined) ?? 0;
      const t = target[sym] ?? 0;
      return { symbol: sym, held: h, target: t, gap: h - t,
               status: h > 0 && t > 0 ? "both" : h > 0 ? "held only" : "target only" };
    });
    renderTable(document.getElementById("drift-table"), out, [
      { key: "symbol", label: "Symbol", fmt: (v2) => el("span", { class: "sym", text: v2 }) },
      { key: "held", label: "Held", num: true, fmt: (v2) => fmtPct(v2, 2) },
      { key: "target", label: spec.targetLabel, num: true, fmt: (v2) => fmtPct(v2, 2) },
      { key: "gap", label: "Gap", num: true,
        cls: (r) => (Math.abs(r.gap) > spec.gapAlert ? (r.gap > 0 ? "neg" : "pos") : ""),
        fmt: (v2) => (v2 >= 0 ? "+" : "−") + (Math.abs(v2) * 100).toFixed(2) + " pp" },
      { key: "status", label: "Status", fmt: (v2) =>
          el("span", { class: `pill ${v2 === "both" ? "" : "warn"}`.trim(), text: v2 }) },
    ], { sortKey: "gap", dir: -1 });
    document.getElementById("drift-note").textContent = B.drift_note || "";
  }

  function activity() {
    const rows = (TX?.rows || []).map(normActivity);
    const note = document.getElementById("activity-note");
    if (!rows.length) {
      document.querySelector("#activity-table").closest(".tbl-wrap").hidden = true;
      note.textContent = ACTIVITY_PENDING;
      return;
    }
    renderTable(document.getElementById("activity-table"), rows.slice(0, 10), [
      { key: "date", label: "Date", fmt: (v2) => fmtDate(v2) },
      { key: "activity", label: "Action", fmt: (v2) =>
          el("span", { class: `pill ${v2 === "buy" ? "up" : v2 === "sell" ? "down" : ""}`.trim(), text: v2 }) },
      { key: "symbol", label: "Security", fmt: (v2, r) => v2 ? el("span", { class: "sym", text: v2 }) : (r.description || "—") },
      { key: "price", label: "Price", num: true, fmt: (v2) => (v2 == null ? "—" : fmtNum(v2, 2)) },
      { key: "size_pct", label: "Size", num: true, fmt: (v2) => (v2 == null ? "—" : fmtPct(v2, 2)) },
    ]);
    note.textContent = `${rows.length} activities on file · sizes are percent of the book at sync time`;
  }

  const all = () => { applyChartDefaults(); stats(); value(); allocation(); table(); drift(); activity(); };
  registerCommands(positions().map((p) => ({ key: p.symbol, hint: "holding", go: spec.symbolLink(p.symbol) })));
  all();
  onThemeChange(all);
}

/* ----------------------------------------------------------------- analytics */

export async function analytics(spec) {
  renderShell();
  const RISK = await loadJSON("data/risk.json").catch(() => null);
  const PF = await loadJSON("data/current_portfolio.json").catch(() => null);
  const B = PF?.books?.[spec.key];
  document.getElementById("book-eyebrow").textContent = B ? `${B.label} · ${B.currency}` : spec.key.toUpperCase();

  let M = null, VIEW = "held";

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
      { label: "Info ratio", value: fmtNum(M.information_ratio) },
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
    const ser = M.series?.drawdown, d = M.series?.dates;
    if (!ser) return;
    draw("dd-chart", {
      type: "line",
      data: { labels: d, datasets: [{ data: ser, borderColor: tok("--down"),
        backgroundColor: alpha("--down", 0.16), fill: true, borderWidth: 1.5,
        pointRadius: 0, pointHoverRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { grid: { display: false }, border: { color: tok("--baseline") },
               ticks: { maxTicksLimit: 7, callback: (v2) => (d[v2] || "").slice(0, 7) } },
          y: { max: 0, grid: { color: tok("--grid") }, border: { display: false },
               ticks: { callback: (v2) => (v2 * 100).toFixed(0) + "%" } },
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
               ticks: { maxTicksLimit: 9, callback(v2) { return this.getLabelForValue(v2) + "%"; } } },
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
    const ser = M.sector_exposure;
    if (!ser?.length) return;
    const colors = ser.map((_, i) => slotColor(i));
    buildLegend("sector-legend", ser.map((x, i) => ({ label: x.sector, color: colors[i], shape: "rect" })));
    document.getElementById("sector-box").style.height = `${40 + ser.length * 26}px`;
    draw("sector-chart", {
      type: "bar",
      data: { labels: ser.map((x) => x.sector), datasets: [{
        data: ser.map((x) => +(x.weight * 100).toFixed(2)), backgroundColor: colors,
        barThickness: 14, borderRadius: { topRight: 2, bottomRight: 2 }, borderSkipped: "start" }] },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 48 } },
        scales: {
          x: { grid: { color: tok("--grid") }, border: { display: false }, ticks: { callback: (v2) => v2 + "%" } },
          y: { grid: { display: false }, border: { color: tok("--baseline") } },
        },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${c.parsed.x}%` } } },
      },
    });
    describeCanvas("sector-chart", `Sector exposure: ${ser.map((x) => `${x.sector} ${(x.weight * 100).toFixed(1)}%`).join(", ")}.`);
    document.getElementById("conc-note").textContent =
      `Effective names ${fmtNum(M.effective_n)} of ${(M.risk_contrib || []).length} measured — HHI ${fmtNum(M.hhi, 4)}.`;
  }

  /* 1/HHI measures how spread the WEIGHTS are; the Meucci measure counts
     independent RISK sources. Only the second answers "am I diversified". */
  function diversification() {
    const eb = M.effective_bets;
    const covered = (M.risk_contrib || []).length;
    const n = (VIEW === "model" ? covered : B?.n_positions) ?? covered;
    renderStats("g-div", [
      { label: "Positions", value: String(n),
        delta: covered < n ? `${covered} with price history` : "all with price history" },
      { label: "1/HHI effective names", value: fmtNum(M.effective_n, 1), delta: "weight dispersion" },
      { label: "Effective bets (risk)", value: eb == null ? "—" : fmtNum(eb, 2),
        tone: eb != null && eb < 3 ? "down" : "", delta: "independent risk sources" },
      { label: "PC1 share of variance", value: fmtPct(M.pc1_share, 0), tone: M.pc1_share > 0.5 ? "down" : "" },
      { label: "Top-5 weight", value: fmtPct(M.top5_weight) },
    ]);
    document.getElementById("div-note").textContent = eb == null ? "" :
      `${covered} of ${n} positions carry price history, and they hold only ${eb.toFixed(1)} independent ` +
      `bets — the first principal component alone carries ${fmtPct(M.pc1_share, 0)} of portfolio variance. ` +
      `1/HHI reports ${fmtNum(M.effective_n, 1)} because it measures how evenly the weights are spread, ` +
      `not how independent the holdings are.`;
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
      `${fmtPct(1 - (t.untagged || 0), 0)} of the book carries a theme tag. Classification is the ` +
      `ETF-intersection signal only, so it reflects what thematic ETFs own, not measured revenue exposure.`;
  }

  function riskContrib() {
    if (!M.risk_contrib?.length) return;
    const rows = M.risk_contrib.map((r) => ({ ...r, ratio: r.weight ? r.pct_risk / r.weight : null }));
    renderTable(document.getElementById("rc-table"), rows, [
      { key: "symbol", label: "Name", fmt: (v2) => el("span", { class: "sym", text: v2 }) },
      { key: "weight", label: "Weight", num: true, fmt: (v2) => fmtPct(v2, 1) },
      { key: "pct_risk", label: "% of risk", num: true, fmt: (v2) => fmtPct(v2, 1) },
      { key: "ratio", label: "Risk / weight", num: true,
        cls: (r) => (r.ratio > 1.25 ? "neg" : r.ratio < 0.8 ? "pos" : ""),
        fmt: (v2) => (v2 == null ? "—" : v2.toFixed(2) + "x") },
    ], { sortKey: "pct_risk", dir: -1 });
  }

  /* The PCA risk model is fitted on the USD trading universe, so the loadings
     are a property of the NAME. A book whose names are not in that universe
     does not get this panel at all. */
  function factors() {
    const panel = document.getElementById("fx-panel");
    if (!spec.factorPanel || !RISK?.exposures) { panel.hidden = true; return; }
    const ev = RISK.factors_explained_var || [];
    const held = new Set((M.risk_contrib || []).map((r) => r.symbol));
    const rows = Object.entries(RISK.exposures).map(([symbol, l]) => ({
      symbol, held: held.has(symbol), f1: l[0], f2: l[1], f3: l[2],
      idio: RISK.idio_share?.[symbol] ?? null, vol: RISK.vol?.[symbol] ?? null,
    }));
    const load = (v2) => (v2 == null ? "—" : v2.toFixed(2));
    const fLabel = (i) => `PC${i + 1}${ev[i] != null ? ` (${fmtPct(ev[i], 0)})` : ""}`;
    renderTable(document.getElementById("fx-table"), rows, [
      { key: "held", label: "Held", fmt: (v2) => v2
          ? el("span", { class: "pill book", text: "held" }) : el("span", { class: "note", text: "—" }) },
      { key: "symbol", label: "Name", fmt: (v2, r) => el("span", { class: "sym" + (r.held ? "" : " muted"), text: v2 }) },
      { key: "f1", label: fLabel(0), num: true, fmt: load },
      { key: "f2", label: fLabel(1), num: true, fmt: load },
      { key: "f3", label: fLabel(2), num: true, fmt: load },
      { key: "vol", label: "Vol", num: true, fmt: (v2) => (v2 == null ? "—" : fmtPct(v2, 0)) },
      { key: "idio", label: "Idiosyncratic", num: true,
        cls: (r) => (r.idio > 0.6 ? "pos" : r.idio < 0.35 ? "neg" : ""),
        fmt: (v2) => (v2 == null ? "—" : fmtPct(v2, 0)) },
    ], { sortKey: "held", dir: -1 });
    document.getElementById("fx-note").textContent =
      `${rows.length} names in the risk model, ${rows.filter((r) => r.held).length} of them in the ` +
      `${VIEW === "model" ? "target" : "held"} book. Idiosyncratic is the share of a name's own variance ` +
      `the factors do not explain — high means it genuinely diversifies, low means it is a proxy for ` +
      `risk you already own.`;
  }

  const all = () => { applyChartDefaults(); groups(); diversification(); themes(); riskContrib();
                      factors(); drawdown(); histogram(); sectors(); };

  async function load(which) {
    M = await loadJSON(which === "model" ? "data/model_metrics.json" : `data/metrics_${spec.key}.json`);
    VIEW = which;
    const note = document.getElementById("book-note");
    if (note) {
      note.textContent = which === "model"
        ? `The engine's target weights as of ${M.book_as_of || "—"} — not what is held.`
        : `The held book as of ${M.book_as_of || "—"}.`;
    }
    setAsOf(M.as_of);
    document.getElementById("intro").textContent =
      (which === "model" ? "The engine's target weights" : "Current holdings") +
      ` applied over the past ${(M.window_days / 252).toFixed(1)} years against the ${M.benchmark}` +
      (M.coverage_pct != null ? ` (${Math.round(M.coverage_pct * 100)}% of the book with price data)` : "") +
      " — hypothetical, since weights change over time. Cash is excluded.";
    all();
  }

  try { await load("held"); }
  catch (err) { showError(document.getElementById("error"), err); return; }

  if (spec.modelToggle) {
    document.getElementById("book-controls").hidden = false;
    document.getElementById("book").addEventListener("click", async (e) => {
      const btn = e.target.closest("button"); if (!btn) return;
      [...e.currentTarget.children].forEach((c) => c.classList.toggle("active", c === btn));
      try { await load(btn.dataset.v); }
      catch (err) { document.getElementById("book-note").textContent = `Unavailable: ${err.message}`; }
    });
  }
  onThemeChange(all);
}

/* ------------------------------------------------------------------ activity */

export async function activity(spec) {
  renderShell();
  const PF = await loadJSON("data/current_portfolio.json").catch(() => null);
  const B = PF?.books?.[spec.key];
  document.getElementById("book-eyebrow").textContent = B ? `${B.label} · ${B.currency}` : spec.key.toUpperCase();

  const QT = await loadJSON(`data/transactions_${spec.key}.json`).catch(() => null);
  const LEGACY = spec.legacyLedger ? await loadJSON("data/transactions.json").catch(() => null) : null;
  if (!QT && !LEGACY) {
    showError(document.getElementById("error"), new Error("no activity files published"));
    return;
  }

  let source = "questrade", rows = [], filter = "All", query = "";
  const current = () => (source === "legacy" ? (LEGACY || []) : (QT?.rows || [])).map(normActivity);

  function paint() {
    const q = query.trim().toLowerCase();
    const view = rows.filter((t) => (filter === "All" || t.activity === filter) &&
      (!q || (t.description + " " + (t.symbol || "")).toLowerCase().includes(q)));
    document.getElementById("tx-count").textContent =
      view.length === rows.length ? `${rows.length} rows` : `${view.length} of ${rows.length} rows`;
    const maxp = Math.max(...rows.map((t) => Math.abs(t.size_pct || 0)), 0.0001);
    renderTable(document.getElementById("tx-table"), view, [
      { key: "date", label: "Date", fmt: (v2) => fmtDate(v2) },
      { key: "activity", label: "Activity", fmt: (v2) =>
          el("span", { class: `pill ${v2 === "buy" ? "up" : v2 === "sell" ? "down" : ""}`.trim(), text: v2 || "—" }) },
      { key: "symbol", label: "Security", fmt: (v2, r) => v2
          ? el("span", {}, [el("span", { class: "sym", text: v2 }),
                            r.description ? el("span", { class: "muted", text: `  ${r.description}` }) : null])
          : el("span", { class: "muted", text: r.description || "—" }) },
      { key: "currency", label: "Ccy" },
      { key: "price", label: "Price", num: true, fmt: (v2) => (v2 ? fmtNum(v2) : "—") },
      { key: "size_pct", label: "Size", num: true, fmt: (v2) =>
          el("div", { style: "display:flex;align-items:center;gap:8px;justify-content:flex-end" }, [
            el("span", { text: v2 == null ? "—" : fmtPct(v2, 2) }),
            el("span", { class: "meter", style: "width:52px" },
               [el("i", { style: `width:${(Math.abs(v2 || 0) / maxp * 100).toFixed(1)}%` })]),
          ]) },
    ], { sortKey: "date", dir: -1 });
  }

  function filters() {
    const host = document.getElementById("filters");
    const counts = new Map();
    for (const t of rows) counts.set(t.activity, (counts.get(t.activity) || 0) + 1);
    host.innerHTML = "";
    for (const k of ["All", ...[...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))]) {
      const n = k === "All" ? rows.length : counts.get(k);
      const btn = el("button", { class: `pill${k === filter ? " on" : ""}`, type: "button",
                                 "aria-pressed": String(k === filter), text: `${k} ${n}` });
      btn.addEventListener("click", () => {
        filter = k;
        [...host.children].forEach((c) => { const on = c === btn; c.classList.toggle("on", on);
                                            c.setAttribute("aria-pressed", String(on)); });
        paint();
      });
      host.appendChild(btn);
    }
  }

  function load() {
    rows = current();
    filter = "All";
    const n = (k) => rows.filter((t) => t.activity === k).length;
    renderStats("stats", [
      { label: "Rows", value: String(rows.length) },
      { label: "Buys", value: String(n("buy")), tone: "up" },
      { label: "Sells", value: String(n("sell")), tone: "down" },
      { label: "Dividends", value: String(n("dividend")) },
      { label: "Contributions", value: String(n("contribution")) },
    ]);
    const note = document.getElementById("tx-note");
    if (source === "legacy") {
      note.textContent = "CIBC Investor's Edge statements, Jan 2024 – Jun 2026, before the account moved to " +
        "Questrade and was split into two books. Sizes are percent of the whole account at the time of the trade.";
    } else if (!rows.length) {
      note.textContent = ACTIVITY_PENDING;
    } else {
      note.textContent = `Questrade activity, ${QT.as_of}. Sizes are percent of the book's equity at the ` +
        "time of the sync, not of the trade.";
    }
    const dates = rows.map((t) => t.date).sort();
    setAsOf(dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : (QT?.as_of || "—"),
            dates.length ? "RANGE" : "AS OF");
    filters();
    paint();
  }

  if (LEGACY) {
    document.getElementById("source-controls").hidden = false;
    document.getElementById("source-note").textContent = `${LEGACY.length} rows in the pre-split ledger`;
    document.getElementById("source").addEventListener("click", (e) => {
      const btn = e.target.closest("button"); if (!btn) return;
      [...e.currentTarget.children].forEach((c) => c.classList.toggle("active", c === btn));
      source = btn.dataset.v; load();
    });
    // Open on the ledger that has rows: defaulting to Questrade showed a page
    // of zeros with 352 rows hidden behind a toggle.
    if (!(QT?.rows || []).length) {
      source = "legacy";
      document.querySelectorAll("#source button")
        .forEach((b) => b.classList.toggle("active", b.dataset.v === "legacy"));
    }
  }
  document.getElementById("tx-search").addEventListener("input", (e) => { query = e.target.value; paint(); });
  load();
}
