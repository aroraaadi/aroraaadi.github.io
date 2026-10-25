/* Market overview: S&P 500 cap weight vs equal weight, the treasury curve, the gauges (macro/market.py -> data/market.json). */
import { loadJSON, showError, el, fmtNum, fmtPct, fmtSigned, signClass, renderTable, renderStats, buildLegend, slotColor } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { applyChartDefaults, draw, lineConfig } from "./charts.js";

const $ = (id) => document.getElementById(id);
const RANGES = [["1y", "1Y", 1], ["3y", "3Y", 3], ["5y", "5Y", 5], ["10y", "10Y", 10], ["max", "Max", 99]];
const WIN = [["1d", "1D"], ["1w", "1W"], ["1m", "1M"], ["3m", "3M"], ["ytd", "YTD"], ["1y", "1Y"]];
const tenor = (t) => (t.startsWith("month") ? t.slice(5) + "M" : t.slice(4) + "Y");
const bp = (x) => (x == null ? "–" : `${x > 0 ? "+" : ""}${Math.round(x * 100)} bp`);
let M = null, RANGE = "3y";

function chips(id, items, current, pick) {
  const box = $(id); box.innerHTML = "";
  items.forEach(([key, label]) => {
    const b = el("button", { type: "button", class: `pill${key === current ? " on" : ""}`, role: "tab", "aria-selected": String(key === current), text: label });
    b.addEventListener("click", () => pick(key));
    box.appendChild(b);
  });
}

// The points of a [date, value] history inside the chosen range.
function cut(hist) {
  const yrs = RANGES.find(([k]) => k === RANGE)[2], end = new Date(hist[hist.length - 1][0]);
  const from = new Date(end); from.setFullYear(end.getFullYear() - yrs);
  const iso = from.toISOString().slice(0, 10);
  return hist.filter(([d]) => d >= iso);
}

// Several histories on one date axis; a date one series lacks is a gap, not a zero.
function align(hists) {
  const maps = hists.map((h) => new Map(h)), labels = [...new Set(hists.flatMap((h) => h.map(([d]) => d)))].sort();
  return { labels, cols: maps.map((m) => labels.map((d) => m.get(d) ?? null)) };
}

function rebased(col) {
  const first = col.find((v) => v != null);
  return col.map((v) => (v == null ? null : (100 * v) / first));
}

function lines(id, legendId, labels, series, yFmt) {
  draw(id, lineConfig({ labels, series, yFmt }));
  if (legendId) buildLegend(legendId, series.map((s) => ({ label: s.label, color: s.color, shape: "line" })));
}

function strip() {
  const L = Object.fromEntries(M.lines.map((r) => [r.symbol, r])), G = Object.fromEntries(M.gauges.map((g) => [g.key, g]));
  const c = M.curve, y = (t) => c.now[c.tenors.indexOf(t)];
  const gap = L.RSP && L.SPY ? L.RSP.ytd - L.SPY.ytd : null;
  renderStats("mk-strip", [
    L["^GSPC"] && { label: "S&P 500", value: L["^GSPC"].last.toLocaleString("en-US", { maximumFractionDigits: 0 }), delta: `${fmtSigned(L["^GSPC"]["1d"], 2)} today`, deltaTone: signClass(L["^GSPC"]["1d"]) },
    gap != null && { label: "Equal minus cap, YTD", value: fmtSigned(gap, 1).replace("%", " pts"), tone: signClass(gap), delta: `RSP ${fmtPct(L.RSP.ytd)} · SPY ${fmtPct(L.SPY.ytd)}` },
    { label: "10y Treasury", value: `${fmtNum(y("year10"))}%`, delta: `${bp(M.curve.moves.year10["1d"])} today` },
    { label: "10y minus 2y", value: bp(y("year10") - y("year2")).replace("+", ""), delta: y("year10") < y("year2") ? "inverted" : "upward sloping" },
    G.vix && { label: "VIX", value: fmtNum(G.vix.last, 1), delta: `${fmtSigned(G.vix["1w"], 0)} on the week`, deltaTone: signClass(-G.vix["1w"]) },
    G.hy_oas && { label: "High-yield spread", value: `${fmtNum(G.hy_oas.last)}%`, delta: `${bp(G.hy_oas["1w"])} on the week`, deltaTone: signClass(-G.hy_oas["1w"]) },
  ]);
}

function tables() {
  const pct = (v) => el("span", { class: signClass(v), text: fmtPct(v) });
  renderTable($("mk-lines"), M.lines, [
    { key: "symbol", label: "Line", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "name", label: "What it is", cls: () => "note" },
    { key: "last", label: "Last", num: true, fmt: (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    ...WIN.map(([k, label]) => ({ key: k, label, num: true, fmt: pct })),
  ]);
  renderTable($("mk-gauges"), M.gauges, [
    { key: "name", label: "Gauge" },
    { key: "last", label: "Last", num: true, fmt: (v, r) => (r.unit === "pct" ? `${fmtNum(v)}%` : fmtNum(v)) },
    { key: "as_of", label: "As of", cls: () => "note" },
    ...WIN.slice(1).map(([k, label]) => ({ key: k, label, num: true,
      fmt: (v, r) => (r.unit === "pct" ? bp(v) : el("span", { text: fmtPct(v) })) })),
  ]);
  const c = M.curve;
  renderTable($("mk-curve-t"), c.tenors.map((t, i) => ({ tenor: tenor(t), y: c.now[i], ...c.moves[t] })), [
    { key: "tenor", label: "Tenor" },
    { key: "y", label: "Yield", num: true, fmt: (v) => `${fmtNum(v)}%` },
    ...WIN.map(([k, label]) => ({ key: k, label, num: true, fmt: bp })),
  ]);
}

function curveChart() {
  const c = M.curve, past = Object.entries(c.past);
  const series = [{ label: `Now (${c.as_of})`, data: c.now, color: slotColor(0), width: 2.5 },
    ...past.map(([k, p], i) => ({ label: `${k} (${p.date})`, data: p.y, color: slotColor(i + 1), dash: [5, 4], width: 1.5 }))];
  lines("mk-curve", "mk-curve-legend", c.tenors.map(tenor), series, (v) => `${fmtNum(v)}%`);
}

function timeCharts() {
  const H = M.history;
  const spx = cut(H["^GSPC"]);
  lines("mk-spx", null, spx.map(([d]) => d), [{ label: "S&P 500", data: spx.map(([, v]) => v), color: slotColor(0), fill: true }],
    (v) => Math.round(v).toLocaleString("en-US"));
  const { labels, cols: [spy, rsp] } = align([cut(H.SPY), cut(H.RSP)]);
  lines("mk-ew", "mk-ew-legend", labels, [
    { label: "Cap weight (SPY)", data: rebased(spy), color: slotColor(0) },
    { label: "Equal weight (RSP)", data: rebased(rsp), color: slotColor(1) },
  ], (v) => fmtNum(v, 0));
  const ratio = rebased(labels.map((_, i) => (spy[i] && rsp[i] ? rsp[i] / spy[i] : null)));
  lines("mk-ratio", null, labels, [{ label: "Equal over cap", data: ratio, color: slotColor(2) }], (v) => fmtNum(v, 1));
  const R = M.rates, r = align(["3m", "2y", "10y", "30y"].map((k) => cut(R[k])));
  lines("mk-rates", "mk-rates-legend", r.labels, ["3m", "2y", "10y", "30y"].map((k, i) => ({ label: k, data: r.cols[i], color: slotColor(i) })),
    (v) => `${fmtNum(v, 1)}%`);
  lines("mk-slope", null, r.labels, [{ label: "10y minus 2y", data: r.labels.map((_, i) =>
    r.cols[2][i] != null && r.cols[1][i] != null ? Math.round((r.cols[2][i] - r.cols[1][i]) * 100) : null), color: slotColor(3), fill: true }],
    (v) => `${v} bp`);
  chips("mk-range", RANGES.map(([k, l]) => [k, l]), RANGE, (k) => { RANGE = k; timeCharts(); });
  $("mk-range-note").textContent = `${RANGES.find(([k]) => k === RANGE)[1]} · charts rebased to 100 at the start of the range`;
}

function render() { strip(); tables(); curveChart(); timeCharts(); }

/* Free-text notes under the breadth line, saved on a debounce (as the company model's notes are). */
function wireNotes() {
  const box = $("mk-notes"), state = $("mk-notes-state"), KEY = "mk-notes-breadth";
  let t = null;
  try { box.value = localStorage.getItem(KEY) || ""; } catch { box.value = ""; }
  box.addEventListener("input", () => {
    clearTimeout(t);
    state.textContent = "Saving…";
    t = setTimeout(() => {
      try { localStorage.setItem(KEY, box.value); state.textContent = `Saved ${new Date().toLocaleTimeString()}`; }
      catch { state.textContent = "Could not save (private browsing?)"; }
    }, 500);
  });
}

async function main() {
  renderShell();
  applyChartDefaults();
  try { M = await loadJSON("data/market.json"); } catch { M = null; }
  if (!M) { showError($("error"), new Error("The market overview has not been published yet.")); return; }
  setAsOf(M.as_of, "AS OF");
  $("mk-method").textContent = M.method;
  wireNotes();
  render();
  onThemeChange(() => { applyChartDefaults(); render(); });
}

main();
