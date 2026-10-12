/* The Global macro page: today's state, its history, what each book does with it, and the tests that decide. */
import { loadJSON, showError, fmtPct, fmtDate, el, renderStats, renderTable, tok } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { applyChartDefaults, draw, lineConfig } from "./charts.js";

const $ = (id) => document.getElementById(id);
const sgn = (x, dp = 2) => (x == null ? "–" : (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(dp));
const spct = (x, dp = 1) => (x == null ? "–" : (x >= 0 ? "+" : "−") + fmtPct(Math.abs(x), dp));
const QUAD = { expansion: "Expansion: growth up, inflation down", reflation: "Reflation: growth up, inflation up",
  stagflation: "Stagflation: growth down, inflation up", slowdown: "Slowdown: growth down, inflation down" };
const GRADE_TONE = { established: "up", replicated: "on", suggestive: "warn", nothing: "muted" };
let M = null, L = null;

// What each book would move, from the design; the status comes from the lab.
const BOOKS = [
  { book: "USD book (TFSA)", moves: "equity share 70-100%, the rest in T-bills, Treasuries or gold by trend", test: "risk", proxy: ["SPY", "QQQ"] },
  { book: "CAD book (TFSA)", moves: "a suggested 0-20% sleeve of short bonds, bonds and gold; the names are never touched", test: "risk", proxy: ["XIC.TO"] },
  { book: "Venture book", moves: "where idle cash parks (T-bills instead of SPY when stressed)", test: "risk", proxy: ["SPY"] },
  { book: "Layered strategy", moves: "gross exposure at half while stressed", test: "return", use: "layered" },
  { book: "Stat-arb paper book", moves: "gross exposure at half while stressed", test: "return", use: "stat-arb" },
  { book: "Swing book", moves: "macro filters in the setup search (dollar, curve, credit, quadrant, stress)", test: "search" },
  { book: "SPY vol sleeve", moves: "the condor's sell gate re-graded on the stress flag", test: "pending" },
];

function strip() {
  const n = M?.now;
  if (!n) return;
  const legs = n.stress_parts || {};
  const on = [legs.vix_inverted && "VIX curve inverted", legs.credit_widening && "credit widening", legs.markov && "high-vol regime"].filter(Boolean);
  renderStats("mc-strip", [
    { label: "Quadrant", value: n.quadrant || "–", delta: n.since ? `since ${fmtDate(n.since)}${n.quadrant_raw && n.quadrant_raw !== n.quadrant ? ` · reading ${n.quadrant_raw} today` : ""}` : "" },
    { label: "Growth", value: sgn(n.growth), tone: n.growth > 0 ? "up" : "down", delta: "z-score against its own history" },
    { label: "Inflation", value: sgn(n.inflation), tone: n.inflation > 0 ? "warn" : "", delta: "z-score against its own history" },
    { label: "Stress", value: n.stress ? "on" : "off", tone: n.stress ? "down" : "up",
      delta: on.length ? on.join(" · ") : `P(high-vol regime) ${n.stress_parts?.p_markov == null ? "–" : fmtPct(n.stress_parts.p_markov, 0)}` },
    { label: "Dollar · curve", value: `${n.dollar_trend > 0 ? "rising" : "falling"} · ${sgn(n.curve_10y3m, 2)}`, delta: `10y-3m, ${sgn(n.curve_change, 2)} in 3 months` },
  ]);
}

function history() {
  if (!M?.history?.length) return;
  const h = M.history;
  const cfg = lineConfig({ labels: h.map((x) => x.date), yFmt: (v) => v.toFixed(1),
    series: [{ label: "Growth", data: h.map((x) => x.g), color: tok("--accent"), width: 1.6 },
             { label: "Inflation", data: h.map((x) => x.i), color: tok("--warn"), width: 1.6 }] });
  draw("mc-chart", cfg);
  const share = Object.entries(M.share || {}).map(([k, v]) => `${k} ${fmtPct(v, 0)}`).join(", ");
  $("mc-h-meta").textContent = `${fmtDate(M.first)} to ${fmtDate(M.as_of)}`;
  $("mc-h-note").textContent = `Above zero is faster growth or rising inflation than usual. Time spent in each quadrant: ${share}. Stressed ${fmtPct(M.stressed_share, 0)} of sessions.`;
  const spells = [];
  for (const x of h) {
    const last = spells[spells.length - 1];
    if (!last || last.q !== x.q) spells.push({ q: x.q, from: x.date, to: x.date, weeks: 1, stressed: x.s ? 1 : 0 });
    else { last.to = x.date; last.weeks += 1; last.stressed += x.s ? 1 : 0; }
  }
  renderTable($("mc-spells"), spells.reverse().slice(0, 40), [
    { key: "q", label: "Quadrant", fmt: (v) => el("span", { text: QUAD[v] || v || "–" }) },
    { key: "from", label: "From", fmt: (v) => fmtDate(v) },
    { key: "to", label: "To", fmt: (v) => fmtDate(v) },
    { key: "weeks", label: "Weeks", num: true },
    { key: "stressed", label: "Weeks stressed", num: true },
  ]);
}

function books() {
  const risk = L?.risk || [], ret = L?.returns || [];
  const rows = BOOKS.map((b) => {
    let status = "not tested yet", tone = "muted";
    if (b.test === "risk" && risk.length) {
      const mine = risk.filter((r) => b.proxy.includes(r.proxy));
      const pass = mine.filter((r) => r.adoptable);
      status = pass.length ? `adopted: ${pass.map((r) => r.use).join(", ")}` : `tested, did not pass (${mine.length} variants)`;
      tone = pass.length ? "up" : "warn";
    } else if (b.test === "return" && ret.length) {
      const r = ret.find((x) => x.use.toLowerCase().startsWith(b.use));
      if (r) { status = r.adoptable ? "adopted" : `tested: ${r.grade}`; tone = r.adoptable ? "up" : "warn"; }
      else status = "no daily returns stored to test on";
    } else if (b.test === "search") status = "joins the swing permutation search with the same false-discovery correction";
    return { ...b, status, tone };
  });
  $("mc-b-note").textContent = "Each book may move only the parameter shown, within the range shown, and only once its test passes. Until then the state is shown, not used.";
  $("mc-b-meta").textContent = L ? `lab run ${fmtDate(L.built.slice(0, 10))}` : "";
  renderTable($("mc-books"), rows, [
    { key: "book", label: "Book", fmt: (v) => el("strong", { text: v }) },
    { key: "moves", label: "What it would move", cls: () => "wrap note" },
    { key: "status", label: "Status", fmt: (v, r) => el("span", { class: `pill ${r.tone}`, text: v }) },
  ]);
}

function riskTable() {
  const rows = (L?.risk || []).map((r) => {
    const t = r.verdict?.test || {}, j = r.verdict?.judged || {};
    return { proxy: r.proxy, use: r.use.replace("_", " "), dd: t.dd_cut, cvar: t.cvar_better, gap: t.sharpe_gap_95, cost: t.cost_per_year,
      bdd: t.base?.max_dd, odd: t.overlay?.max_dd, jdd: j.dd_cut, pass: r.adoptable };
  });
  $("mc-r-meta").textContent = rows.length ? `${rows.length} variants · test 2018 on` : "";
  $("mc-r-note").textContent = "To be adopted, in the test years a variant must cut the worst drawdown by at least 25%, improve the 95% daily CVaR, "
    + "lose no more than 0.10 of Sharpe at 90% confidence (paired block bootstrap), and cost no more than 2% a year.";
  renderTable($("mc-risk"), rows, [
    { key: "proxy", label: "Book proxy" },
    { key: "use", label: "Variant" },
    { key: "bdd", label: "Worst drawdown, held", num: true, fmt: (v) => spct(v, 0) },
    { key: "odd", label: "With the layer", num: true, fmt: (v) => spct(v, 0) },
    { key: "dd", label: "Cut", num: true, fmt: (v) => fmtPct(v, 0) },
    { key: "cvar", label: "CVaR better", fmt: (v) => (v ? "yes" : "no"), cls: () => "note" },
    { key: "gap", label: "Sharpe loss, 95th pct", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) },
    { key: "cost", label: "Cost a year", num: true, fmt: (v) => spct(v, 1) },
    { key: "pass", label: "Verdict", fmt: (v) => el("span", { class: `pill ${v ? "up" : "muted"}`, text: v ? "adopt" : "no" }) },
  ], { empty: "The lab has not run yet." });
}

function retTable() {
  const rows = (L?.returns || []).map((r) => ({ use: r.use, jm: r.verdict?.judged?.mean_month, jt: r.verdict?.judged?.t, tm: r.verdict?.test?.mean_month,
    tt: r.verdict?.test?.t, grade: r.grade, bh: r.bh_judged }));
  $("mc-t-meta").textContent = rows.length ? `${rows.length} uses · monthly, net of costs` : "";
  renderTable($("mc-ret"), rows, [
    { key: "use", label: "Use against its benchmark", cls: () => "wrap" },
    { key: "jm", label: "2006-17 a month", num: true, fmt: (v) => spct(v, 2) },
    { key: "jt", label: "t", num: true, fmt: (v) => sgn(v, 1) },
    { key: "tm", label: "2018 on a month", num: true, fmt: (v) => spct(v, 2) },
    { key: "tt", label: "t", num: true, fmt: (v) => sgn(v, 1) },
    { key: "grade", label: "Grade", fmt: (v) => el("span", { class: `pill ${GRADE_TONE[v] || "muted"}`, text: v || "–" }) },
  ], { empty: "The lab has not run yet." });
}

let BUCKET = null, SERIES = null;

function trendPill(v) {
  if (v == null) return el("span", { class: "note", text: "–" });
  return el("span", { class: `pill ${v ? "up" : "down"}`, text: v ? "uptrend" : "downtrend" });
}

function chips(id, items, current, pick) {
  const box = $(id); box.innerHTML = "";
  items.forEach((it) => {
    const b = el("button", { type: "button", class: `pill${it.key === current ? " on" : ""}`, role: "tab", "aria-selected": String(it.key === current), text: it.label });
    b.addEventListener("click", () => pick(it.key));
    box.appendChild(b);
  });
}

function buckets() {
  const bs = M?.buckets || [];
  $("mc-k-meta").textContent = bs.length ? `${bs.reduce((a, b) => a + b.n, 0)} ETFs in ${bs.length} buckets · total return` : "";
  $("mc-k-note").textContent = bs.length
    ? "Each bucket's lines as of the last close, on total-return prices. Uptrend is the layer's trend rule: the mean of the 1-, 3- and 12-month returns in excess of T-bills is above zero. Pick a bucket below to see every line in it."
    : "The buckets are published with the next macro state run.";
  renderTable($("mc-buckets"), bs.map((b) => ({ ...b, key: b.key })), [
    { key: "label", label: "Bucket", fmt: (v) => el("strong", { text: v }) },
    { key: "n", label: "Lines", num: true },
    { key: "up_share", label: "In uptrend", num: true, fmt: (v) => (v == null ? "–" : fmtPct(v, 0)) },
    { key: "median_r3m", label: "Median 3 months", num: true, fmt: (v) => spct(v, 1) },
  ], { empty: "Not published yet." });
  if (!bs.length) return;
  BUCKET = BUCKET || bs[0].key;
  chips("mc-k-chips", bs, BUCKET, (k) => { BUCKET = k; buckets(); });
  const b = bs.find((x) => x.key === BUCKET) || bs[0];
  renderTable($("mc-bucket"), b.rows, [
    { key: "symbol", label: "Line", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "name", label: "What it holds", cls: () => "note" },
    { key: "r1m", label: "1 month", num: true, fmt: (v) => spct(v, 1) },
    { key: "r3m", label: "3 months", num: true, fmt: (v) => spct(v, 1) },
    { key: "r12m", label: "12 months", num: true, fmt: (v) => spct(v, 1) },
    { key: "trend", label: "Trend", fmt: trendPill },
    { key: "vol3m", label: "Vol, 3 months", num: true, fmt: (v) => (v == null ? "–" : fmtPct(v, 0)) },
    { key: "dd", label: "From 52-week high", num: true, fmt: (v) => spct(v, 1) },
  ], { sortKey: "r3m", dir: -1 });
}

const UNIT = (n) => (["claims"].includes(n) ? "count" : ["dollar_broad", "dollar_afe", "dollar_eme", "usdcad", "usdjpy", "eurusd", "wti", "natgas", "copper", "cpi", "nfci", "cfnai", "vix", "vix3m"].includes(n) ? "level" : "pct");
const val = (v, n) => (v == null ? "–" : UNIT(n) === "pct" ? `${v.toFixed(2)}%` : UNIT(n) === "count" ? Math.round(v).toLocaleString() : v.toFixed(v >= 100 ? 1 : 2));
const chg = (v, n) => (v == null ? "–" : (v >= 0 ? "+" : "\u2212") + (UNIT(n) === "pct" ? `${Math.abs(v * 100).toFixed(0)} bp` : UNIT(n) === "count" ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(2)));

function series() {
  const sb = M?.series_buckets || [];
  $("mc-s-meta").textContent = sb.length ? `${sb.reduce((a, b) => a + b.rows.length, 0)} series from FRED` : "";
  $("mc-s-note").textContent = sb.length
    ? "Each value is placed on the day it became public (the publication lag applied), so a monthly figure can be weeks old. Percentile is where today's value sits in the series' own history since 1995. Series that are revised after release are marked; the tested macro state never uses them."
    : "";
  if (!sb.length) return;
  SERIES = SERIES || sb[0].label;
  chips("mc-s-chips", sb.map((b) => ({ key: b.label, label: b.label })), SERIES, (k) => { SERIES = k; series(); });
  const b = sb.find((x) => x.label === SERIES) || sb[0];
  renderTable($("mc-series"), b.rows, [
    { key: "label", label: "Series", cls: () => "wrap", fmt: (v, r) => el("div", {}, [el("strong", { text: v }), el("div", { class: "note", text: `${r.fred_id}${r.revised ? " · revised after release" : ""}` })]) },
    { key: "value", label: "Latest", num: true, fmt: (v, r) => val(v, r.name) },
    { key: "available", label: "Public on", cls: () => "note", fmt: (v) => fmtDate(v) },
    { key: "ch1m", label: "1 month", num: true, fmt: (v, r) => chg(v, r.name) },
    { key: "ch3m", label: "3 months", num: true, fmt: (v, r) => chg(v, r.name) },
    { key: "pct", label: "Percentile", num: true, fmt: (v) => (v == null ? "–" : fmtPct(v, 0)) },
  ]);
}

async function main() {
  renderShell();
  applyChartDefaults();
  try { M = await loadJSON("data/macro.json"); } catch { M = null; }
  try { L = await loadJSON("data/macro_lab.json"); } catch { L = null; }
  if (!M) { showError($("error"), new Error("The macro state has not been published yet.")); return; }
  setAsOf(M.as_of, "AS OF");
  strip(); history(); buckets(); series(); books(); riskTable(); retTable();
  $("mc-method").textContent = (M.method || "") + (L ? "\n\nTests:\n" + L.method : "");
  onThemeChange(() => { applyChartDefaults(); history(); });
}

main();
