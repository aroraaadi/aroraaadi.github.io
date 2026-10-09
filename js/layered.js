/* The layered strategy page: tonight's reasoned decisions, the backtest, the races and the test account. */
import { loadJSON, showError, fmtPct, fmtDate, el, renderStats, renderTable, tok, words } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { applyChartDefaults, draw, lineConfig } from "./charts.js";

const $ = (id) => document.getElementById(id);
const spct = (x, dp = 1) => (x == null ? "–" : (x > 0 ? "+" : "") + fmtPct(x, dp));
const num = (x, dp = 2) => (x == null ? "–" : x.toFixed(dp));
const FAM = { overvaluation_short: "Overvaluation short", reversal_long: "Reversal long", momentum_pullback: "Momentum pullback",
  earnings_drift_long: "Earnings drift long", earnings_drift_short: "Earnings drift short", news_long: "News long", news_short: "News short",
  breakdown_short: "Breakdown short", orb: "Opening-range breakout", gap_fade: "Gap fade", late_momentum: "Late-day momentum", vwap_revert: "VWAP reversion" };
const fam = (k) => FAM[k] || words(k);
const REGIME = { thrust: "breadth thrust", healthy: "healthy", neutral: "neutral", divergence: "divergence", weak: "weak", capitulation: "capitulation" };
let D = null, BT = null, RC = null, IX = null, TR = null;

function strip() {
  const b = D?.backdrop || {};
  renderStats("ly-strip", [
    { label: "Backdrop", value: REGIME[D?.regime] || "–", tone: D?.regime === "divergence" || D?.regime === "weak" ? "warn" : D?.regime ? "up" : "", delta: D ? `as of ${fmtDate(D.as_of)}` : "not run yet" },
    { label: "Above the 50-day", value: b.pct_above_50 == null ? "–" : fmtPct(b.pct_above_50, 0), delta: `above the 200-day ${b.pct_above_200 == null ? "–" : fmtPct(b.pct_above_200, 0)}` },
    { label: "SPY from its high", value: spct(b.spy_dd, 1), delta: b.divergence ? "narrowing: index near its high, breadth thinning" : "" },
    { label: "VIX", value: num(b.vix, 1), delta: b.vix_term == null ? "" : `VIX / VIX3M ${num(b.vix_term, 2)}${b.vix_term >= 1 ? " (inverted)" : ""}` },
    { label: "Tonight", value: D ? `${D.orders.length} orders` : "–", delta: D ? `${D.candidates} candidates · ${D.considered.length} passed over` : "" },
  ]);
}

function orders() {
  const box = $("ly-orders"); box.innerHTML = "";
  if (!D) { $("ly-o-note").textContent = "The strategy runs each evening once its data is in place."; return; }
  $("ly-o-meta").textContent = `${D.orders.length} for the next open · equity ${D.equity ? "$" + Math.round(D.equity).toLocaleString() : "–"}`;
  $("ly-o-note").textContent = D.orders.length ? "Each decision in the order the layers made it: the backdrop, the setup, the evidence by layer for and against, the expected move, then the plan with its stop, target and risk budget."
    : "No order tonight: every candidate was vetoed, not expected to pay after costs, or blocked by a limit (see below).";
  D.orders.forEach((o) => {
    box.appendChild(el("div", { class: "sw-story" }, [
      el("div", { class: "sw-story-h" }, [el("span", { class: "sym", text: o.symbol }), el("span", { class: "note", text: fam(o.family) }),
        el("span", { class: `pill ${o.side > 0 ? "up" : "down"}`, text: o.side > 0 ? "long" : "short" }), el("span", { class: "spacer" }),
        el("span", { class: "note", text: `risk ${fmtPct(o.plan.risk, 2)}` })]),
      el("p", { class: "sw-story-t", text: o.rationale }),
    ]));
  });
}

function considered() {
  const rows = D?.considered || [];
  $("ly-c-meta").textContent = `${rows.length} candidates`;
  renderTable($("ly-considered"), rows, [
    { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v || "–" }) },
    { key: "family", label: "Setup", fmt: fam },
    { key: "side", label: "Side", cls: () => "note", fmt: (v) => (v > 0 ? "long" : "short") },
    { key: "mu", label: "Expected", num: true, fmt: (v) => spct(v, 2) },
    { key: "conv", label: "Conviction", num: true, fmt: (v) => num(v, 2) },
    { key: "why_not", label: "Why not", cls: () => "note wrap" },
  ], { empty: "Nothing else was proposed tonight." });
}

function backtest() {
  if (!BT) { $("ly-b-note").textContent = "The backtest has not been run yet."; $("ly-b-chart").closest(".chart").style.display = "none"; return; }
  const s = BT.stats, i = s.in_sample || {}, o = s.out_of_sample || {}, t = s.trades || {};
  $("ly-b-meta").textContent = `${t.n ? t.n.toLocaleString() : 0} trades · 2016 to ${BT.nav.length ? BT.nav[BT.nav.length - 1][0].slice(0, 4) : "–"}`;
  renderStats("ly-b-strip", [
    { label: "Sharpe, 2016-2020", value: num(i.sharpe), delta: `return ${spct(i.ann_return)} a year · vol ${fmtPct(i.ann_vol, 0)}` },
    { label: "Sharpe, 2021 on (test)", value: num(o.sharpe), tone: o.sharpe > 1 ? "up" : o.sharpe < 0 ? "down" : "", delta: `return ${spct(o.ann_return)} a year · vol ${fmtPct(o.ann_vol, 0)}` },
    { label: "Worst drawdown, test", value: spct(o.max_drawdown, 1), delta: `Sortino ${num(o.sortino)}` },
    { label: "Trades", value: t.n ? t.n.toLocaleString() : "–", delta: t.n ? `hit ${fmtPct(t.hit, 0)} · mean ${spct(t.mean_ret, 2)} · ${num(t.mean_r)}R · ${num(t.avg_hold, 1)} days` : "" },
    { label: "Exposure", value: `${fmtPct(s.exposure?.gross_mean, 0)} gross`, delta: `net ${spct(s.exposure?.net_mean, 0)} on average · max gross ${fmtPct(s.exposure?.gross_max, 0)}` },
  ]);
  const cfg = lineConfig({ labels: BT.nav.map((x) => x[0]), yFmt: (v) => "$" + Math.round(v / 1000) + "k",
    series: [{ label: "Equity", data: BT.nav.map((x) => x[1]), color: tok("--accent"), width: 2, fill: true }] });
  cfg.options.plugins.legend = { display: false };
  draw("ly-b-chart", cfg);
  $("ly-b-note").textContent = "The default strategy on $100,000, compounding, net of costs and borrow. 2016-2020 is where every choice was made; 2021 on is the test.";
  const fams = Object.entries(t.by_family || {}).map(([k, v]) => ({ family: k, ...v }));
  renderTable($("ly-fam"), fams, [
    { key: "family", label: "Setup", fmt: fam }, { key: "n", label: "Trades", num: true, fmt: (v) => v.toLocaleString() },
    { key: "hit", label: "Hit", num: true, fmt: (v) => fmtPct(v, 0) }, { key: "mean_ret", label: "Mean a trade", num: true, fmt: (v) => spct(v, 2) },
    { key: "pnl", label: "P&L", num: true, fmt: (v) => el("span", { class: v > 0 ? "up" : "down", text: (v < 0 ? "−$" : "$") + Math.abs(Math.round(v)).toLocaleString() }) },
  ]);
}

function races() {
  if (!RC) { $("ly-r-note").textContent = "The races run with the backtest."; return; }
  $("ly-r-meta").textContent = `${RC.n_variants} variants`;
  renderStats("ly-r-strip", [
    { label: "Chosen on 2016-2020", value: words(RC.chosen.replace("only:", "only ").replace(":", ": ")), delta: RC.chosen_by },
    { label: "Deflated Sharpe, test years", value: num(RC.deflated_sharpe_oos), tone: RC.deflated_sharpe_oos >= 0.95 ? "up" : "warn", delta: "needs 0.95: the chance the edge is real after the variants tried" },
    { label: "Probability of overfitting", value: num(RC.pbo), tone: RC.pbo < 0.5 ? "up" : "down", delta: "needs under 0.5 (16-block cross-validation)" },
    { label: "Deployable", value: RC.deployable ? "yes" : "no", tone: RC.deployable ? "up" : "warn", delta: RC.deployable ? "may move to the deploy account" : "stays on the test account" },
  ]);
  $("ly-r-note").textContent = "Each variant is the same book with one methodology changed. The choice uses 2016-2020 only; the test years are shown for all, so you can see what choosing cost.";
  const rows = Object.entries(RC.variants).map(([k, v]) => ({ k, in_s: v.in_sample?.sharpe, out_s: v.out_of_sample?.sharpe, out_r: v.out_of_sample?.ann_return,
    dd: v.out_of_sample?.max_drawdown, n: v.trades?.n, chosen: k === RC.chosen }));
  renderTable($("ly-races"), rows, [
    { key: "k", label: "Variant", fmt: (v, r) => el("span", { class: r.chosen ? "up" : "", text: (r.chosen ? "✓ " : "") + v.replace("only:", "only ").replace(/_/g, " ").replace(":", ": ") }) },
    { key: "in_s", label: "Sharpe 2016-20", num: true, fmt: (v) => num(v) }, { key: "out_s", label: "Sharpe 2021 on", num: true, fmt: (v) => el("span", { class: v > 0 ? "up" : "down", text: num(v) }) },
    { key: "out_r", label: "Return a year (test)", num: true, fmt: (v) => spct(v, 1) }, { key: "dd", label: "Worst drawdown (test)", num: true, fmt: (v) => spct(v, 1) },
    { key: "n", label: "Trades", num: true, fmt: (v) => (v == null ? "–" : v.toLocaleString()) },
  ], { sortKey: "in_s", dir: -1 });
}

function intraday() {
  if (!IX) { $("ly-i-note").textContent = "The intraday families are tested once the five-minute history is complete."; return; }
  $("ly-i-meta").textContent = `${IX.sessions} sessions · test from ${fmtDate(IX.split)}`;
  $("ly-i-note").textContent = `Sharpe ${num(IX.in_sample?.sharpe)} before ${fmtDate(IX.split)} and ${num(IX.out_of_sample?.sharpe)} after, all families together, risking 0.25% of equity a trade, net of intraday costs.`;
  renderTable($("ly-intra"), Object.entries(IX.by_family || {}).map(([k, v]) => ({ family: k, ...v })), [
    { key: "family", label: "Family", fmt: fam }, { key: "n", label: "Trades", num: true, fmt: (v) => v.toLocaleString() },
    { key: "hit", label: "Hit", num: true, fmt: (v) => fmtPct(v, 0) }, { key: "mean_ret", label: "Mean a trade", num: true, fmt: (v) => spct(v, 3) },
    { key: "mean_r", label: "Mean R", num: true, fmt: (v) => num(v) }, { key: "t_out", label: "t (test)", num: true, fmt: (v) => num(v, 1) },
  ]);
}

function trader() {
  const a = TR?.account || {};
  $("ly-t-meta").textContent = TR ? `updated ${TR.as_of.replace("T", " ")}` : "not trading yet";
  renderStats("ly-t-strip", [
    { label: "Equity", value: a.equity ? "$" + Math.round(a.equity).toLocaleString() : "–", delta: "paper money, test account" },
    { label: "Long", value: a.long_value ? "$" + Math.round(a.long_value).toLocaleString() : "$0" },
    { label: "Short", value: a.short_value ? "$" + Math.round(Math.abs(a.short_value)).toLocaleString() : "$0" },
    { label: "Closed trades", value: String((TR?.closed || []).length) },
  ]);
  renderTable($("ly-pos"), TR?.positions || [], [
    { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) }, { key: "family", label: "Setup", fmt: fam },
    { key: "side", label: "Side", cls: () => "note", fmt: (v) => (v > 0 ? "long" : "short") }, { key: "qty", label: "Shares", num: true },
    { key: "entry", label: "Entry", num: true, fmt: (v) => num(v) }, { key: "stop", label: "Stop (close)", num: true, fmt: (v) => num(v) },
    { key: "cat", label: "Emergency stop", num: true, fmt: (v) => num(v) }, { key: "target", label: "Target", num: true, fmt: (v) => num(v) },
    { key: "held", label: "Held", num: true, fmt: (v, r) => `${v} of ${r.hmax}` },
  ], { empty: "No positions yet: the test account starts once the trader's job is loaded." });
}

(async function init() {
  renderShell();
  try { D = await loadJSON("data/layered.json"); } catch { D = null; }
  try { BT = await loadJSON("data/layered_backtest.json"); } catch { BT = null; }
  try { RC = await loadJSON("data/layered_races.json"); } catch { RC = null; }
  try { IX = await loadJSON("data/layered_intraday.json"); } catch { IX = null; }
  try { TR = await loadJSON("data/layered_trader.json"); } catch { TR = null; }
  setAsOf(D?.as_of || (BT ? "backtest" : "not run"), "AS OF", { ages: !!D });
  applyChartDefaults();
  try { strip(); orders(); considered(); backtest(); races(); intraday(); trader(); } catch (err) { showError($("error"), err); }
  onThemeChange(() => { applyChartDefaults(); backtest(); });
})();
