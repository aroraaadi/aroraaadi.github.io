/* Candidate model books, side by side.

   Each revision is solved by the same optimizer, risk model and constraint code
   as the live book; exactly one thing varies per revision and the page says
   which. The point is to make the choice between them arguable — so the table
   leads with what changed, not with which one won. */

import {
  loadJSON, showError, fmtPct, fmtNum, fmtSigned, el, renderStats, renderTable,
  breakdownColors, signClass, tok,
} from "./common.js";
import { applyChartDefaults, draw, describeCanvas } from "./charts.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";

let D = null;

const pct = (x, dp = 1) => fmtPct(x, dp);

function renderHeadline() {
  const revs = D.revisions.filter((r) => r.ok);
  const live = revs.find((r) => r.key === "live");
  const best = revs.reduce((a, b) => (b.sharpe > (a?.sharpe ?? -9) ? b : a), null);
  const hair = revs.find((r) => r.key === "haircut");
  renderStats("headline", [
    { label: "Revisions solved", value: `${revs.length} of ${D.revisions.length}`,
      delta: "same optimizer, one variation each" },
    live ? { label: "Live book", value: pct(live.expected_return),
             delta: `vol ${pct(live.vol)} · Sharpe ${fmtNum(live.sharpe, 2)}` } : null,
    best && live ? { label: "Best Sharpe", value: fmtNum(best.sharpe, 2),
                     tone: best.sharpe > live.sharpe ? "up" : "",
                     delta: `${best.label} · ${fmtSigned(best.expected_return - live.expected_return)} return` } : null,
    hair && live ? { label: "Survives halved views", value: hair.sharpe > live.sharpe ? "yes" : "no",
                     tone: hair.sharpe > live.sharpe ? "up" : "down",
                     delta: `Sharpe ${fmtNum(hair.sharpe, 2)} vs ${fmtNum(live.sharpe, 2)} live` } : null,
    { label: "Candidates", value: String(Object.keys(D.candidates).length),
      delta: D.held_out?.length ? `${D.held_out.length} held out for short history` : "all with enough history" },
  ]);
}

function renderTableView() {
  const rows = D.revisions.map((r) => ({
    label: r.label, change: r.change, ok: r.ok,
    vol: r.vol, er: r.expected_return, sharpe: r.sharpe,
    n: r.n_positions, sat: r.satellite_weight,
    ai: r.cluster_exposure?.ai_complex,
    names: Object.entries(r.satellite_names || {}).map(([t, w]) => `${t} ${fmtPct(w, 1)}`).join(", "),
    error: r.error,
  }));
  const live = rows.find((r) => r.label === "As run today");
  renderTable(document.getElementById("rev-table"), rows, [
    { key: "label", label: "Revision", fmt: (v, r) =>
        el("span", {}, [el("b", { text: v }), el("span", { class: "note", style: "display:block",
          text: r.ok ? r.change : `did not solve: ${r.error || ""}` })]), cls: () => "wrap" },
    { key: "vol", label: "Vol", num: true, fmt: (v) => (v == null ? "—" : pct(v)) },
    { key: "er", label: "Expected return", num: true,
      cls: (r) => (live && r.er > live.er ? "pos" : ""),
      fmt: (v) => (v == null ? "—" : pct(v)) },
    { key: "sharpe", label: "Sharpe", num: true,
      cls: (r) => (live && r.sharpe > live.sharpe ? "pos" : r.sharpe < live?.sharpe ? "neg" : ""),
      fmt: (v) => (v == null ? "—" : fmtNum(v, 2)) },
    { key: "n", label: "Names", num: true, fmt: (v) => (v == null ? "—" : String(v)) },
    { key: "sat", label: "Satellite", num: true, fmt: (v) => (v == null ? "—" : pct(v, 1)) },
    { key: "ai", label: "AI cluster", num: true, fmt: (v) => (v == null ? "—" : pct(v, 0)) },
    { key: "names", label: "Which", cls: () => "wrap",
      fmt: (v) => el("span", { class: "sym", text: v || "—" }) },
  ], { sortKey: null });
}

/* Expected return against volatility. The live book is the reference point, so
   it is drawn as a ring rather than a dot and everything else is read relative
   to it. */
function renderScatter() {
  const revs = D.revisions.filter((r) => r.ok);
  const live = revs.find((r) => r.key === "live");
  const colors = breakdownColors(revs.length);
  draw("rev-chart", {
    type: "scatter",
    data: { datasets: revs.map((r, i) => ({
      label: r.label,
      data: [{ x: r.vol * 100, y: r.expected_return * 100 }],
      backgroundColor: r.key === "live" ? "transparent" : colors[i],
      borderColor: r.key === "live" ? tok("--ink") : colors[i],
      borderWidth: r.key === "live" ? 2 : 1,
      pointRadius: 7, pointHoverRadius: 10,
    })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: "volatility" }, grid: { color: tok("--grid") },
             border: { color: tok("--baseline") }, ticks: { callback: (v) => v + "%" } },
        y: { title: { display: true, text: "expected return" }, grid: { color: tok("--grid") },
             border: { display: false }, ticks: { callback: (v) => v + "%" } },
      },
      plugins: { tooltip: { callbacks: {
        label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}% return at ${c.parsed.x.toFixed(1)}% vol` } } },
    },
  });
  describeCanvas("rev-chart", "Expected return against volatility for each revision: " +
    revs.map((r) => `${r.label} ${pct(r.expected_return)} at ${pct(r.vol)}`).join(", ") + ".");
  document.getElementById("rev-chart-note").textContent =
    live ? `The ring is the live book at ${pct(live.expected_return)} for ${pct(live.vol)}. `
         + "Everything above and to the left of it is a better trade-off on these inputs — which "
         + "are expected returns, not outcomes." : "";
}

function renderCandidates() {
  const rows = Object.entries(D.candidates).map(([sym, c]) => ({
    symbol: sym, why: c.why, view: c.view, vol: c.vol,
    cover: c.cash_cover, verdict: c.verdict,
    held: D.revisions.filter((r) => r.ok && (r.satellite_names || {})[sym]).length,
  }));
  renderTable(document.getElementById("cand-table"), rows, [
    { key: "symbol", label: "Name", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "view", label: "View", num: true, cls: (r) => signClass(r.view),
      fmt: (v) => (v == null ? "—" : pct(v)) },
    { key: "vol", label: "Volatility", num: true,
      cls: (r) => (r.vol > 0.5 ? "neg" : ""), fmt: (v) => (v == null ? "—" : pct(v, 0)) },
    { key: "cover", label: "Cash cover", num: true, fmt: (v) => (v == null ? "—" : fmtNum(v, 1) + "x") },
    { key: "held", label: "Held in", num: true,
      fmt: (v) => el("span", { class: `pill ${v ? "book" : "warn"}`, text: `${v} of ${D.revisions.length}` }) },
    { key: "why", label: "Why it is a candidate", cls: () => "wrap" },
  ], { sortKey: "view", dir: -1 });
  document.getElementById("cand-note").textContent = D.view_basis;
  if (D.held_out?.length) {
    document.getElementById("cand-heldout").textContent =
      `Held out of every revision for short price history: ${D.held_out.join(", ")}.`;
  }
}

/* Every revision's weights, so a book can be read rather than inferred from
   its summary statistics. */
function renderWeights() {
  const revs = D.revisions.filter((r) => r.ok);
  const all = [...new Set(revs.flatMap((r) => Object.keys(r.weights)))];
  const order = all.sort((a, b) =>
    (revs[0].weights[b] || 0) - (revs[0].weights[a] || 0) || a.localeCompare(b));
  const sat = new Set(Object.keys(D.candidates));
  const rows = order.map((t) => {
    const row = { symbol: t, satellite: sat.has(t) };
    for (const r of revs) row[r.key] = r.weights[t] || 0;
    return row;
  });
  renderTable(document.getElementById("w-table"), rows, [
    { key: "symbol", label: "Name", fmt: (v, r) => el("span", {}, [
        el("span", { class: "sym", text: v }),
        r.satellite ? el("span", { class: "pill book", style: "margin-left:8px", text: "candidate" }) : null]) },
    ...revs.map((r) => ({
      key: r.key, label: r.label, num: true,
      cls: (row) => (row.satellite && row[r.key] > 0 ? "pos" : ""),
      fmt: (v) => (v ? fmtPct(v, 1) : el("span", { class: "note", text: "—" })),
    })),
  ], { sortKey: revs[0]?.key, dir: -1 });
}

function renderAll() {
  applyChartDefaults();
  renderHeadline(); renderTableView(); renderScatter(); renderCandidates(); renderWeights();
}

(async function init() {
  renderShell();
  try {
    D = await loadJSON("data/revisions.json");
  } catch (err) {
    showError(document.getElementById("error"), err); return;
  }
  setAsOf(D.as_of);
  renderAll();
  onThemeChange(renderAll);
})();
