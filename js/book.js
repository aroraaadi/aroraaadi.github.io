/* A book's overview. One module serves both books: <main data-book> says which. */

import {
  loadJSON, showError, fmtPct, fmtNum, fmtSigned, fmtDate, signClass,
  tok, breakdownColors, el, renderStats, buildLegend, renderTable,
} from "./common.js";
import { applyChartDefaults, draw, lineConfig, doughnutConfig, describeCanvas } from "./charts.js";
import { renderShell, setAsOf, onThemeChange, registerCommands } from "./shell.js";

const BOOK = document.querySelector("main").dataset.book;
let PF = null, B = null, MET = null, HIST = null, TX = null, MODEL = null;

const positions = () => [...B.positions].sort((a, b) => b.weight - a.weight);

function renderHeader() {
  document.getElementById("book-eyebrow").textContent =
    `${B.currency} · ${B.managed_by === "model" ? "run by the engine" : "run by hand"} · benchmark ${B.benchmark}`;
  document.getElementById("book-title").textContent = B.label;
  document.getElementById("book-mandate").textContent = B.mandate;
}

function renderStatsStrip() {
  const rows = positions();
  const top = rows[0];
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
    outside.length ? { label: "Outside the model", value: String(outside.length), tone: "down",
                       delta: outside.map((p) => p.symbol).join(", ") } : null,
    stale.length ? { label: "Stale prices", value: String(stale.length), tone: "down",
                     delta: stale.map((s) => s.symbol).join(", ") } : null,
  ]);
}

function renderValue() {
  const pts = HIST?.books?.[BOOK] || [];
  const meta = document.getElementById("value-meta"), note = document.getElementById("value-note");
  if (pts.length < 2) {
    document.querySelector("#value-chart").closest(".chart").hidden = true;
    meta.textContent = pts[0] ? `index starts ${fmtDate(pts[0].date)}` : "";
    note.textContent = "The book was split out on 2026-09-21. Its value index starts at 100 that day and " +
      "gains a point with every daily sync; a line needs two of them.";
    return;
  }
  const labels = pts.map((p) => p.date);
  const series = [{ label: B.label, data: pts.map((p) => p.value_index), color: tok(`--${BOOK}`) }];
  buildLegend("value-legend", series.map((s) => ({ label: s.label, color: s.color, shape: "line" })));
  draw("value-chart", lineConfig({ labels, series, yFmt: (v) => v.toFixed(1) }));
  describeCanvas("value-chart", `${B.label} value index, ${pts.length} daily points since ${pts[0].date}.`);
  const last = pts[pts.length - 1];
  meta.textContent = `${fmtSigned(last.value_index / 100 - 1)} since ${fmtDate(pts[0].date)}`;
  note.textContent = "Equity in the book's own currency, indexed to 100 at the split. Contributions move it too; " +
    "a time-weighted line follows once the activity log fills in.";
}

function renderAllocation() {
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
    el("span", { class: "num", text: fmtPct(values.reduce((s, v) => s + v, 0) / 100, 2) }),
  ]));
}

function renderPositions() {
  const rows = positions();
  const order = rows.map((r) => r.symbol);
  const colors = breakdownColors(rows.length);
  renderTable(document.getElementById("pos-table"), rows.map((p) => ({
    symbol: p.symbol, name: p.name || "", kind: p.kind, weight: p.weight,
    ret: p.return_pct ?? null, in_model: p.in_model, stale: !!p.stale_price,
  })), [
    { key: "symbol", label: "Symbol", fmt: (v) => el("span", {}, [
        el("span", { class: "dot", style: `background:${colors[order.indexOf(v)]}` }),
        el("span", { class: "sym", text: v })]) },
    { key: "name", label: "Name", fmt: (v) => el("span", { class: "muted", text: v }) },
    { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "ret", label: "Since entry", num: true, cls: (r) => (r.ret > 0 ? "pos" : r.ret < 0 ? "neg" : ""),
      fmt: (v) => (v == null ? "—" : fmtSigned(v, 1)) },
    ...(B.managed_by === "model" ? [{ key: "in_model", label: "Model", fmt: (v) =>
        v ? el("span", { class: "pill book", text: "in model" }) : el("span", { class: "pill warn", text: "outside model" }) }] : []),
    { key: "stale", label: "Price", fmt: (v) => v ? el("span", { class: "pill warn", text: "book cost" }) : el("span", { class: "note", text: "live" }) },
  ], { sortKey: "weight", dir: -1 });
  document.getElementById("pos-count").textContent = `${rows.length} positions · weights within this book`;
}

/* The evidence that a book is managed: where it sits against what it is
   managed toward. The USD book's target is the engine's; the CAD book's is
   the owner's stated intent of equal weight. */
function renderDrift() {
  const rows = positions();
  const table = document.getElementById("drift-table");
  const title = document.getElementById("drift-title"), meta = document.getElementById("drift-meta"),
        note = document.getElementById("drift-note");
  let target = new Map(), label;
  if (B.managed_by === "model" && MODEL?.holdings) {
    for (const h of MODEL.holdings) target.set(h.ticker, h.weight);
    title.textContent = "Held vs the engine's target"; label = "Target";
    meta.textContent = `target as of ${MODEL.as_of}`;
  } else {
    const inv = rows.filter((p) => p.in_model !== false);
    for (const p of inv) target.set(p.symbol, 1 / inv.length);
    title.textContent = "Drift from equal weight"; label = "Equal weight";
    meta.textContent = `${inv.length} names · ${fmtPct(1 / inv.length, 1)} each`;
  }
  const held = new Map(rows.map((p) => [p.symbol, p.weight]));
  // The USD book publishes by broker symbol; its USD-equivalent view is what the model keys on.
  const names = new Set([...held.keys(), ...target.keys()]);
  const out = [...names].map((s) => {
    const h = held.get(s) ?? (BOOK === "usd" ? (PF.usd_positions || []).find((u) => u.symbol === s)?.weight : undefined) ?? 0;
    const t = target.get(s) ?? 0;
    return { symbol: s, held: h, target: t, gap: h - t,
             status: h > 0 && t > 0 ? "both" : h > 0 ? "held only" : "target only" };
  });
  const abs = out.reduce((s, r) => s + Math.abs(r.gap), 0) / 2;
  renderTable(table, out, [
    { key: "symbol", label: "Symbol", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "held", label: "Held", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "target", label, num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "gap", label: "Gap", num: true, cls: (r) => (Math.abs(r.gap) > 0.03 ? (r.gap > 0 ? "neg" : "pos") : ""),
      fmt: (v) => (v >= 0 ? "+" : "−") + (Math.abs(v) * 100).toFixed(2) + " pp" },
    { key: "status", label: "Status", fmt: (v) => el("span", { class: `pill ${v === "both" ? "" : "warn"}`.trim(), text: v }) },
  ], { sortKey: "gap", dir: -1 });
  note.textContent = B.managed_by === "model"
    ? `One-way distance to the target: ${fmtPct(abs, 1)}. The engine suggests; the owner trades on the quarterly ` +
      `cadence, so a gap is expected between rebalances. Names marked "outside model" are held for reasons the model does not price.`
    : `One-way distance to equal weight: ${fmtPct(abs, 1)}. The book is rebalanced by hand; drift is price movement since the last top-up, not a decision.`;
}

function renderActivity() {
  const rows = TX?.rows || [];
  const note = document.getElementById("activity-note");
  if (!rows.length) {
    document.querySelector("#activity-table").closest(".tbl-wrap").hidden = true;
    note.textContent = "No activity published yet — Questrade's activity endpoint timed out at the last sync. The log fills in when it answers.";
    return;
  }
  renderTable(document.getElementById("activity-table"), rows.slice(0, 10), [
    { key: "date", label: "Date", fmt: (v) => fmtDate(v) },
    { key: "action", label: "Action", fmt: (v) => el("span", { class: `pill ${v === "buy" ? "up" : v === "sell" ? "down" : ""}`.trim(), text: v }) },
    { key: "symbol", label: "Security", fmt: (v, r) => v ? el("span", { class: "sym", text: v }) : (r.description || "—") },
    { key: "price", label: "Price", num: true, fmt: (v) => (v == null ? "—" : fmtNum(v, 2)) },
    { key: "size_pct", label: "Size", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v, 2)) },
  ]);
  note.textContent = `${rows.length} activities on file · sizes are percent of the book at sync time`;
}

function renderAll() {
  applyChartDefaults();
  renderStatsStrip(); renderValue(); renderAllocation(); renderPositions(); renderDrift(); renderActivity();
}

(async function init() {
  renderShell();
  try {
    PF = await loadJSON("data/current_portfolio.json");
    B = PF.books[BOOK];
    if (!B) throw new Error(`no ${BOOK} book in current_portfolio.json`);
  } catch (err) {
    showError(document.getElementById("error"), err); return;
  }
  const s = await Promise.allSettled([
    loadJSON(`data/metrics_${BOOK}.json`), loadJSON("data/book_history.json"),
    loadJSON(`data/transactions_${BOOK}.json`), loadJSON("data/portfolio.json"),
  ]);
  const v = (i) => (s[i].status === "fulfilled" ? s[i].value : null);
  MET = v(0); HIST = v(1); TX = v(2); MODEL = v(3);
  setAsOf(PF.as_of);
  renderHeader();
  registerCommands(positions().map((p) => ({ key: p.symbol, hint: "holding",
    go: BOOK === "usd" ? `${window.ASSET_BASE}usd/fundamentals.html#${p.symbol}` : `${window.ASSET_BASE}cad/index.html` })));
  renderAll();
  onThemeChange(renderAll);
})();
