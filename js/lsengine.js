/* The L/S engine's pages (engine_ls/ -> data/engine_ls.json, engine_ls_backtest.json, engine_ls_alpaca.json). One
   script; the page's #ls-root data-view picks what it draws: book, signals, risk, trades, evidence, method. */

import { loadJSON, showError, el, fmtPct, fmtDate, renderStats, renderTable, money, tok } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const $ = (id) => document.getElementById(id);
// The page's own panels say which view it is (sturdier than a data attribute in every DOM this runs in).
const view = () => ($("ls-strip") ? "book" : $("ls-coefs") ? "signals" : $("ls-target") ? "risk" : $("ls-trades") ? "trades"
  : $("ls-curve") ? "evidence" : "method");
const usd = (x) => money(x, "USD", 0);
const r2 = (x) => (x == null ? "–" : Number(x).toFixed(2));
const tcell = (t) => el("span", { class: t == null ? "note" : Math.abs(t) >= 2 ? (t > 0 ? "up" : "down") : "", text: t == null ? "–" : Number(t).toFixed(2) });
const wcell = (v) => el("span", { class: v > 0 ? "up" : v < 0 ? "down" : "", text: fmtPct(v, 2) });
const load = async (p) => { try { return await loadJSON(p); } catch { return null; } };

async function line(id, labels, series) {
  const { draw, lineConfig } = await import("./charts.js");
  const cfg = lineConfig({ labels, yFmt: (v) => v.toFixed(2), series });
  cfg.options.plugins.legend = { display: series.length > 1 };
  draw(id, cfg);
}

function status(B, T) {
  const s = $("ls-status");
  if (!s) return;
  const oos = T && T.out_of_sample ? T.out_of_sample.modelled : null;
  s.textContent = `${(B && B.status) || "UNPROVEN: a forward test on paper."}` +
    (oos && oos.sharpe != null ? ` Backtest after 2021, net of modelled costs: Sharpe ${r2(oos.sharpe)}${oos.sharpe <= 0 ? " — it did not beat its costs" : ""}.` : "");
}

function book(B, A) {
  const d = B.days || [];
  const last = d[d.length - 1] || {};
  renderStats("ls-strip", [
    { label: "Value", value: usd(B.nav), delta: `${fmtPct(B.return_total, 2)} since ${B.started ? fmtDate(B.started) : "start"}` },
    { label: "Long", value: last.nav ? fmtPct(last.long / last.nav, 0) : "–" },
    { label: "Short", value: last.nav ? fmtPct(last.short / last.nav, 0) : "–" },
    { label: "Names", value: String(last.n ?? 0) },
    { label: "Next", value: B.pending ? `fills ${fmtDate(B.pending.decided)}+1` : "–", delta: B.pending ? `${Object.keys(B.pending.target || {}).length} names targeted` : (B.note || "") },
  ]);
  if (d.length > 1) line("ls-nav", d.map((x) => x.date), [{ label: "Book, $", data: d.map((x) => x.nav), color: tok("--accent"), width: 2, fill: true }]);
  $("ls-nav-meta").textContent = d.length ? `${d.length} sessions` : "";
  renderTable($("ls-hold"), B.holdings || [], [
    { key: "symbol", label: "Name" },
    { key: "weight", label: "Weight", num: true, fmt: wcell },
    { key: "shares", label: "Shares", num: true, fmt: (v) => (v == null ? "–" : v.toLocaleString()) },
  ], { sortKey: "weight", dir: -1, empty: "No positions yet." });
  $("ls-hold-meta").textContent = (B.holdings || []).length ? `${B.holdings.length} lines` : "";
  const rows = (A && A.series) || [];
  renderTable($("ls-acct"), rows.slice().reverse(), [
    { key: "date", label: "Date", fmt: (v) => fmtDate(v) },
    { key: "account", label: "Account index", num: true, fmt: r2 },
    { key: "book", label: "Book index", num: true, fmt: r2 },
  ], { empty: "The account starts with the first fill." });
}

function signals(B) {
  const co = Object.entries(B.alpha || {}).map(([k, v]) => ({ name: k, ...v }));
  renderTable($("ls-coefs"), co, [
    { key: "name", label: "Ingredient" },
    { key: "raw", label: "Weight, 2015-2020", num: true, fmt: (v) => (v == null ? "–" : (v * 100).toFixed(3) + "%") },
    { key: "t", label: "t", num: true, fmt: tcell },
    { key: "kept", label: "Used", fmt: (v) => el("span", { class: v ? "up" : "note", text: v ? "yes, halved" : "no" }) },
  ], { sortKey: "t", dir: -1 });
  const cols = [
    { key: "symbol", label: "Name" },
    { key: "alpha", label: "Expected 5 days", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "z_sa", label: "Stat arb z", num: true, fmt: r2 },
    { key: "w", label: "Target", num: true, fmt: wcell },
  ];
  const s = B.signals || {};
  renderTable($("ls-top"), s.top || [], cols, { empty: "Set on rebalance nights." });
  renderTable($("ls-bottom"), s.bottom || [], cols, { empty: "Set on rebalance nights." });
}

function riskv(B) {
  const t = B.target || {};
  renderStats("ls-risk-strip", [
    { label: "Gross", value: fmtPct(t.gross, 0) }, { label: "Net", value: fmtPct(t.net, 1) },
    { label: "Beta to IWM", value: r2(t.beta) }, { label: "Turnover", value: fmtPct(t.turnover, 1), delta: "of value, this rebalance" },
  ]);
  const w = Object.entries(t.weights || {}).map(([k, v]) => ({ symbol: k, w: v }));
  renderTable($("ls-target"), w, [{ key: "symbol", label: "Name" }, { key: "w", label: "Weight", num: true, fmt: wcell }], { sortKey: "w", dir: -1, empty: "Set on rebalance nights." });
  renderTable($("ls-sector"), Object.entries(t.by_sector || {}).map(([k, v]) => ({ sector: k, w: v })), [
    { key: "sector", label: "Sector" }, { key: "w", label: "Net", num: true, fmt: wcell }], { sortKey: "w", dir: -1 });
  const kn = (B.knobs || (B.chosen ? {} : {}));
  renderTable($("ls-knobs"), Object.entries({ ...kn, cadence: B.chosen?.cadence, kappa: B.chosen?.kappa, lambda: B.chosen?.lam }).map(([k, v]) => ({ k, v })), [
    { key: "k", label: "Knob" }, { key: "v", label: "Value", fmt: (v) => (v == null ? "–" : String(v)) }]);
}

function trades(B) {
  const rv = B.review || {};
  $("ls-rev-meta").textContent = rv.reviewed ? `${rv.reviewed} reviewed${rv.held_back?.length ? `; held back: ${rv.held_back.join(", ")}` : ""}${rv.degraded ? ` (${rv.why})` : ""}` : (rv.note || "No review yet.");
  renderTable($("ls-rev"), Object.entries(rv.verdicts || {}).map(([s, v]) => ({ symbol: s, ...v })), [
    { key: "symbol", label: "Name" }, { key: "keep", label: "Verdict", fmt: (v) => el("span", { class: v ? "up" : "down", text: v ? "kept" : "held back" }) },
    { key: "plausibility", label: "Plausibility", num: true, fmt: r2 }, { key: "rejects", label: "Rejects", num: true }], { empty: "No review yet." });
  renderTable($("ls-trades"), (B.trades || []).slice().reverse(), [
    { key: "date", label: "Date", fmt: (v) => fmtDate(v) }, { key: "symbol", label: "Name" },
    { key: "qty", label: "Shares", num: true, fmt: (v) => el("span", { class: v > 0 ? "up" : "down", text: v.toLocaleString() }) },
    { key: "px", label: "Price", num: true, fmt: r2 }, { key: "cost", label: "Cost", num: true, fmt: (v) => usd(v) }], { empty: "No trades yet." });
  $("ls-trades-meta").textContent = (B.trades || []).length ? `${B.trades.length} trades` : "";
}

function evidence(T) {
  if (!T) return;
  const o = T.out_of_sample || {}, i = T.in_sample || {};
  renderStats("ls-ev-strip", [
    { label: "Chosen", value: `${T.chosen?.cadence || "–"}, κ ${T.chosen?.kappa ?? "–"}`, delta: `on ${T.chosen?.on || "2015-2020"}` },
    { label: "Sharpe 2015-20", value: r2(i.modelled?.sharpe), delta: "net of modelled costs" },
    { label: "Sharpe 2021 on", value: r2(o.modelled?.sharpe), delta: `at 25 bp: ${r2(o.flat_25bp?.sharpe)}` },
    { label: "Deflated Sharpe", value: r2(T.deflated_sharpe_oos), delta: `PBO ${r2(T.pbo)}` },
  ]);
  const c = T.curve || [];
  if (c.length) line("ls-curve", c.map((x) => x[0]), [{ label: "Net, modelled costs", data: c.map((x) => x[1]), color: tok("--accent"), width: 2 }]);
  $("ls-curve-meta").textContent = `split at ${T.split}`;
  const rows = [];
  for (const [p, blk] of [["2015-2020", i], ["2021 on", o]])
    for (const [k, lab] of [["zero_cost", "no costs"], ["modelled", "modelled costs"], ["flat_25bp", "25 bp a side"]]) {
      const s = blk[k] || {};
      rows.push({ period: p, cost: lab, sharpe: s.sharpe, ret: s.ann_return, dd: s.max_drawdown, turn: s.turnover_day, t: s.weekly_t });
    }
  renderTable($("ls-split"), rows, [
    { key: "period", label: "Period" }, { key: "cost", label: "Costs" }, { key: "sharpe", label: "Sharpe", num: true, fmt: r2 },
    { key: "ret", label: "A year", num: true, fmt: (v) => fmtPct(v, 1) }, { key: "dd", label: "Worst drawdown", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "turn", label: "Turnover a day", num: true, fmt: (v) => fmtPct(v, 1) }, { key: "t", label: "Weekly t", num: true, fmt: tcell }]);
  renderTable($("ls-variants"), Object.entries(T.variants || {}).map(([k, s]) => ({ v: k, ...s })), [
    { key: "v", label: "Cadence | κ" }, { key: "sharpe", label: "Sharpe", num: true, fmt: r2 }, { key: "ann_return", label: "A year", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "turnover_day", label: "Turnover a day", num: true, fmt: (v) => fmtPct(v, 1) }, { key: "max_drawdown", label: "Worst drawdown", num: true, fmt: (v) => fmtPct(v, 1) }], { sortKey: "sharpe", dir: -1 });
}

(async function init() {
  renderShell();
  const v = view();
  const [B, T, A] = await Promise.all([load("data/engine_ls.json"), load("data/engine_ls_backtest.json"), load("data/engine_ls_alpaca.json")]);
  if (!B && v !== "method" && v !== "evidence") { showError($("error"), new Error("The engine has not run yet.")); return; }
  setAsOf((B && B.as_of) || (T && T.built && T.built.slice(0, 10)));
  status(B, T);
  if (v === "book") book(B, A);
  else if (v === "signals") signals(B);
  else if (v === "risk") riskv(B);
  else if (v === "trades") trades(B);
  else if (v === "evidence") evidence(T);
})();
