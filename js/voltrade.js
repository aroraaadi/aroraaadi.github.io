/* The SPY vol strategy page: reads docs/data/vol_strategy.json only. */
import { loadJSON, showError, fmtPct, fmtNum, el, renderStats, renderTable, signed, signClass, tok, slotColors, buildLegend } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";
import { draw, lineConfig, applyChartDefaults } from "./charts.js";

let D = null;
const pct = (x, dp = 1) => (x == null ? "—" : fmtPct(x, dp));
const pts = (x, dp = 1) => (x == null ? "—" : `${signed(x * 100, dp)} pts`);
const bp = (x, dp = 0) => (x == null || Number.isNaN(x) ? "—" : `${signed(x, dp)} bp`);
const tstat = (t) => (t == null || Number.isNaN(t) ? "—" : fmtNum(t, 2));
const GRADE = { established: "up", "established against": "down", "not established": "", "no test": "" };
const STRUCT = { short_condor: "Short iron condor", long_straddle: "Long straddle", calendar: "Calendar" };
const MODE = { rules_as_written: "Papers' rules as written", sell_gated_rank: "Sell, gated, IV rank required", sell_gated: "Sell, gated (the policy)",
               always_short: "Always short condor", always_long: "Always long straddle", never: "Never" };

function header() {
  const p = D.proposal, ch = D.signal.checks;
  document.getElementById("vt-meta").textContent =
    `${D.underlying} ${fmtNum(D.spot, 2)} · read ${D.as_of.slice(0, 10)} · rules live: ${D.rules.enabled.map((s) => STRUCT[s]).join(", ") || "none"}` +
    ` · IV rank ${D.rules.require_rank_to_sell ? "required" : "not required"} to sell · ${D.funded ? "funded" : "unfunded sleeve, sized per $100k"}`;
  const kind = p.kind;
  renderStats("vt-strip", [
    { label: "Proposal", value: kind === "OPEN" ? STRUCT[p.structure] : kind, delta: kind === "OPEN" ? `${p.detail.dte} days · ${p.legs.length} legs` : p.note, tone: kind === "OPEN" ? "book" : "" },
    { label: "Expected premium", value: pts(ch.expected_vrp), delta: `VIX ${pct(ch.iv30)} vs EWMA forecast ${pct(ch.rv_forecast)} · floor ${pts(D.thresholds.vrp_min_sell, 0)}`, tone: ch.paid ? "up" : "down" },
    { label: "IV rank, 1y", value: fmtNum(ch.iv_rank, 2), delta: ch.rich ? "rich (≥ 0.50)" : ch.cheap ? "cheap (≤ 0.30)" : "middle of the cone" },
    { label: "VIX / VIX3M", value: fmtNum(ch.term_ratio, 2), delta: ch.inverted ? "inverted: no short front" : "contango", tone: ch.inverted ? "down" : "" },
    { label: "P(stressed)", value: pct(ch.p_stressed, 0), delta: ch.stressed ? "stressed: no new short" : "calm", tone: ch.stressed ? "down" : "up" },
    { label: "Next FOMC", value: ch.days_to_fomc == null ? "—" : `${ch.days_to_fomc} d`, delta: D.next_fomc ? `${D.next_fomc.date}${D.next_fomc.projections ? " · with projections" : ""}` : "calendar exhausted", tone: ch.fomc_blackout ? "down" : "" },
  ]);
}

function checks() {
  const ch = D.signal.checks, th = D.thresholds;
  const rows = [
    { chk: "Implied above forecast realised", val: pts(ch.expected_vrp), thr: `≥ ${pts(th.vrp_min_sell, 0)}`, ok: ch.paid, role: "required to sell" },
    { chk: "Regime calm", val: pct(ch.p_stressed, 0), thr: "P(stressed) < 50%", ok: !ch.stressed, role: "required to sell" },
    { chk: "Curve not inverted", val: fmtNum(ch.term_ratio, 2), thr: `VIX/VIX3M < ${th.term_inverted.toFixed(2)}`, ok: !ch.inverted, role: "required to sell" },
    { chk: "Off the FOMC", val: ch.days_to_fomc == null ? "—" : `${ch.days_to_fomc} days`, thr: `> ${th.blackout_days} days`, ok: !ch.fomc_blackout, role: "required to sell" },
    { chk: "IV rank rich", val: fmtNum(ch.iv_rank, 2), thr: `≥ ${th.iv_rank_sell.toFixed(2)}`, ok: ch.rich, role: D.rules.require_rank_to_sell ? "required to sell" : "shown, not required (backtest: no help)" },
    { chk: "IV rank cheap", val: fmtNum(ch.iv_rank, 2), thr: `≤ ${th.iv_rank_buy.toFixed(2)}`, ok: ch.cheap, role: D.rules.enabled.includes("long_straddle") ? "required to buy" : "long-vol rule disabled (backtest: lost)" },
    { chk: "Catalyst in the long-vol window", val: ch.fomc_in_window ? "yes" : "no", thr: `FOMC ≤ ${th.catalyst_window_days} days`, ok: ch.fomc_in_window, role: D.rules.enabled.includes("long_straddle") ? "one reason to buy" : "shown only" },
    { chk: "Crude-vol lead (OVX, 5-day change)", val: ch.ovx_weekly_change == null ? "—" : signed(ch.ovx_weekly_change, 1), thr: `≥ +${th.ovx_spike}`, ok: ch.ovx_spike, role: ch.ovx_rule_established ? "one reason to buy" : "shown only: tested, sign reversed" },
  ];
  renderTable(document.getElementById("vt-checks"), rows, [
    { key: "chk", label: "Check" }, { key: "val", label: "Now", num: true }, { key: "thr", label: "Threshold" },
    { key: "ok", label: "State", fmt: (v) => el("span", { class: `pill ${v ? "up" : "warn"}`, text: v ? "pass" : "no" }) },
    { key: "role", label: "Role in the live rules" },
  ]);
  document.getElementById("vt-reasons").textContent = `Signal: ${D.signal.structure ? STRUCT[D.signal.structure] : "nothing"} — ${D.signal.reasons.join(", ")}.`;
}

function proposal() {
  const p = D.proposal, d = p.detail || {};
  renderTable(document.getElementById("vt-legs"), p.legs.map((l) => ({ ...l, sideL: l.side > 0 ? "LONG" : "SHORT", rightL: l.right === "P" ? "put" : "call" })), [
    { key: "sideL", label: "Side", fmt: (v) => el("span", { class: `pill ${v === "SHORT" ? "warn" : ""}`, text: v }) },
    { key: "expiry", label: "Expiry" }, { key: "strike", label: "Strike", num: true, fmt: (v) => fmtNum(v, 0) }, { key: "rightL", label: "Right" },
    { key: "mid", label: "Mid", num: true, fmt: (v) => fmtNum(v, 2) }, { key: "delta", label: "Δ", num: true, fmt: (v) => signed(v, 2) },
    { key: "iv", label: "IV", num: true, fmt: (v) => pct(v, 1) },
  ]);
  const host = document.getElementById("vt-detail"); host.innerHTML = "";
  if (p.kind !== "OPEN") { host.appendChild(el("p", { class: "note", text: p.note || p.reason || "no proposal" })); return; }
  const isCredit = d.credit != null;
  renderStats(host, [
    { label: isCredit ? "Credit" : "Debit", value: fmtNum(isCredit ? d.credit : d.debit, 2), delta: "per share; × 100 per contract" },
    { label: "Max loss", value: fmtNum(d.max_loss, 2), delta: isCredit ? `wing width ${fmtNum(d.width, 0)} − credit` : "the debit", tone: "down" },
    { label: "Max gain", value: d.max_gain == null ? "uncapped" : fmtNum(d.max_gain, 2), delta: d.expected_move_priced != null ? `straddle prices a ${pct(d.expected_move_priced)} move` : "" },
    { label: "Break-evens", value: (d.breakevens || []).map((x) => fmtNum(x, 0)).join(" / "), delta: d.short_range ? `short strikes ${d.short_range.map((x) => fmtNum(x, 0)).join(" / ")}` : "" },
    { label: "Size per $100k", value: p.contracts_per_100k == null ? "—" : `${fmtNum(p.contracts_per_100k, 0)} contracts`, delta: `${pct(p.risk_share, 0)} of the sleeve at max loss` },
    { label: "Net delta", value: signed(p.delta_per_share, 3), delta: "per share at the mids" },
  ]);
  const ex = d.exits || {};
  const exits = [ex.dte != null ? `close or roll at ${ex.dte} DTE` : null, ex.profit_take != null ? `take profit at ${pct(ex.profit_take, 0)} of the credit` : null,
                 ex.stop_mult != null ? `stop at ${ex.stop_mult}× the credit` : null, ex.front_dte != null ? `close when the front leg reaches ${ex.front_dte} DTE` : null].filter(Boolean);
  host.appendChild(el("p", { class: "note", style: "margin-top:10px", text: `Exits: ${exits.join("; ")}.` }));
  // payoff
  const pay = D.payoff || [];
  if (pay.length) {
    const labels = pay.map((x) => x.spot), data = pay.map((x) => x.pnl);
    draw("vt-payoff", { type: "line",
      data: { labels, datasets: [{ label: "P&L per share at expiry", data, borderColor: tok("--book") || tok("--accent"), borderWidth: 2, pointRadius: 0, fill: { target: "origin", above: tok("--up") + "33", below: tok("--down") + "33" }, tension: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        scales: { x: { grid: { display: false }, border: { color: tok("--baseline") }, ticks: { maxTicksLimit: 9, callback: (v) => fmtNum(labels[v], 0) } },
                  y: { grid: { color: tok("--grid") }, border: { display: false }, ticks: { callback: (v) => signed(v, 1) } } },
        plugins: { tooltip: { callbacks: { title: (it) => `spot ${fmtNum(labels[it[0].dataIndex], 2)}`, label: (c) => ` ${signed(c.parsed.y, 2)} per share` } } } } });
    document.getElementById("vt-payoff-note").textContent = `spot ${fmtNum(D.spot, 2)} now · ${pay[0].spot.toFixed(0)} to ${pay[pay.length - 1].spot.toFixed(0)}`;
  }
}

function verdicts() {
  const bt = D.backtest; const v = (bt || {}).verdicts || {};
  const rows = Object.entries(v).map(([k, x]) => ({ rule: k.replace(/_/g, " "), claim: x.claim, n: x.n ?? x.n_gated ?? x.n_with, t: x.t, grade: x.grade,
    detail: x.mean_bp != null ? `mean ${bp(x.mean_bp)} per trade · win ${pct(x.win_rate, 0)}` :
            x.diff_bp != null ? `${bp(x.gated_mean_bp ?? x.with_rank_mean_bp)} vs ${bp(x.always_mean_bp ?? x.without_mean_bp)} per trade` :
            x.b != null ? `b ${fmtNum(x.b, 3)} on ${x.n} weeks · Nelson reported +0.30 (t 2.53)` : "",
    live: k === "short_condor_pays" ? D.rules.enabled.includes("short_condor") : k === "buy_when_cheap" ? D.rules.enabled.includes("long_straddle") :
          k === "calendar_on_inversion" ? D.rules.enabled.includes("calendar") : k === "iv_rank_gate_helps" ? D.rules.require_rank_to_sell : k === "ovx_lead" ? D.signal.checks.ovx_rule_established : null }));
  renderTable(document.getElementById("vt-verdicts"), rows, [
    { key: "rule", label: "Rule" }, { key: "claim", label: "What it claims" }, { key: "n", label: "n", num: true },
    { key: "t", label: "t", num: true, cls: (r) => signClass(Math.abs(r.t) >= 3 ? r.t : 0), fmt: tstat },
    { key: "grade", label: "Grade", fmt: (v) => el("span", { class: `pill ${GRADE[v] || ""}`, text: v }) },
    { key: "detail", label: "" },
    { key: "live", label: "Traded", fmt: (v) => (v == null ? "—" : el("span", { class: `pill ${v ? "on" : ""}`, text: v ? "yes" : "no" })) },
  ]);
}

function backtest() {
  const bt = D.backtest; const note = document.getElementById("vt-bt-note");
  if (!bt) { note.textContent = "no backtest yet"; return; }
  note.textContent = `synthetic prices, ${bt.start} → ${bt.end} · ${bt.model.iv_model} · skew ${fmtNum(bt.model.skew_pts * 100, 0)}/${fmtNum(bt.model.call_skew_pts * 100, 0)} pts fixed · half-spread ${pct(bt.model.spread_half, 0)} · ${pct(bt.model.max_loss_share, 0)} of the sleeve at risk per trade`;
  const st = bt.stats;
  const rows = Object.entries(st).filter(([m]) => m !== "never").map(([m, s]) => ({ mode: MODE[m] || m, cagr: s.cagr, vol: s.ann_vol, sharpe: s.sharpe, dd: s.max_drawdown, worst: s.worst_year, t: s.t_daily_nw, n: s.n_trades }));
  renderTable(document.getElementById("vt-modes"), rows, [
    { key: "mode", label: "Mode" }, { key: "cagr", label: "CAGR", num: true, cls: (r) => signClass(r.cagr), fmt: (v) => pct(v, 1) },
    { key: "vol", label: "Vol", num: true, fmt: (v) => pct(v, 1) }, { key: "sharpe", label: "Sharpe", num: true, fmt: (v) => fmtNum(v, 2) },
    { key: "dd", label: "Max DD", num: true, fmt: (v) => pct(v, 0) }, { key: "worst", label: "Worst year", num: true, fmt: (v) => pct(v, 0) },
    { key: "t", label: "t (NW)", num: true, fmt: tstat }, { key: "n", label: "Trades", num: true },
  ]);
  const srows = [];
  for (const m of ["sell_gated", "rules_as_written", "always_short", "always_long"]) for (const [k, b] of Object.entries((st[m] || {}).by_structure || {}))
    srows.push({ mode: MODE[m], st: STRUCT[k], n: b.n, win: b.win_rate, mean: b.mean_bp, med: b.median_bp, worst: b.worst_bp, t: b.t, days: b.avg_days,
                 exits: Object.entries(b.exits || {}).map(([a, c]) => `${a} ${c}`).join(" · ") });
  renderTable(document.getElementById("vt-structs"), srows, [
    { key: "mode", label: "Mode" }, { key: "st", label: "Structure" }, { key: "n", label: "n", num: true },
    { key: "win", label: "Win", num: true, fmt: (v) => pct(v, 0) }, { key: "mean", label: "Mean / trade", num: true, cls: (r) => signClass(r.mean), fmt: (v) => bp(v) },
    { key: "med", label: "Median", num: true, fmt: (v) => bp(v) }, { key: "worst", label: "Worst", num: true, fmt: (v) => bp(v) },
    { key: "t", label: "t", num: true, fmt: tstat }, { key: "days", label: "Days held", num: true, fmt: (v) => fmtNum(v, 0) }, { key: "exits", label: "Exits" },
  ]);
  const ep = bt.episodes || {};
  const eps = Object.keys(ep.sell_gated || {});
  renderTable(document.getElementById("vt-episodes"), eps.map((k) => ({ ep: ep.sell_gated[k].label, pol: ep.sell_gated[k].sleeve_return, alw: (ep.always_short[k] || {}).sleeve_return, lng: (ep.always_long[k] || {}).sleeve_return, rul: (ep.rules_as_written[k] || {}).sleeve_return })), [
    { key: "ep", label: "Episode" }, { key: "pol", label: "Sell, gated", num: true, cls: (r) => signClass(r.pol), fmt: (v) => pct(v, 1) },
    { key: "alw", label: "Always short", num: true, cls: (r) => signClass(r.alw), fmt: (v) => pct(v, 1) },
    { key: "lng", label: "Always long", num: true, cls: (r) => signClass(r.lng), fmt: (v) => pct(v, 1) },
    { key: "rul", label: "Rules as written", num: true, cls: (r) => signClass(r.rul), fmt: (v) => pct(v, 1) },
  ]);
  // nav chart, weekly, rebased to 100
  const modes = ["sell_gated", "always_short", "always_long", "rules_as_written"];
  const dates = Object.keys(bt.nav.sell_gated);
  const colors = slotColors(modes.length);
  draw("vt-nav", lineConfig({ labels: dates, series: modes.map((m, i) => ({ label: MODE[m], color: colors[i], data: dates.map((d) => (bt.nav[m][d] == null ? null : bt.nav[m][d] / 1000)), width: m === "sell_gated" ? 2.5 : 1.5 })),
    yFmt: (v) => fmtNum(v, 0) }));
  buildLegend("vt-nav-legend", modes.map((m, i) => ({ label: MODE[m], color: colors[i], shape: "line" })));
  // by year
  const by = st.sell_gated.by_year || {};
  renderTable(document.getElementById("vt-years"), Object.entries(by).map(([y, r]) => ({ y: +y, r, a: (st.always_short.by_year || {})[y], l: (st.always_long.by_year || {})[y] })), [
    { key: "y", label: "Year", num: true }, { key: "r", label: "Sell, gated", num: true, cls: (x) => signClass(x.r), fmt: (v) => pct(v, 1) },
    { key: "a", label: "Always short", num: true, cls: (x) => signClass(x.a), fmt: (v) => pct(v, 1) }, { key: "l", label: "Always long", num: true, cls: (x) => signClass(x.l), fmt: (v) => pct(v, 1) },
  ], { sortKey: "y", dir: 1 });
  renderTable(document.getElementById("vt-trades"), (bt.trades || []).slice().reverse(), [
    { key: "opened", label: "Opened" }, { key: "closed", label: "Closed" }, { key: "days", label: "Days", num: true },
    { key: "vix", label: "VIX at open", num: true, fmt: (v) => fmtNum(v, 1) }, { key: "iv_rank", label: "IV rank", num: true, fmt: (v) => fmtNum(v, 2) },
    { key: "why", label: "Exit" }, { key: "pnl_bp", label: "P&L", num: true, cls: (r) => signClass(r.pnl_bp), fmt: (v) => bp(v) },
  ]);
  // OVX
  const o = bt.ovx_test || {};
  const host = document.getElementById("vt-ovx"); host.innerHTML = "";
  if (o.dvrp_on_dovx) renderStats(host, [
    { label: "ΔVRP on ΔOVX(−1)", value: `b ${signed(o.dvrp_on_dovx.b1, 3)}`, delta: `t ${tstat(o.dvrp_on_dovx.t1)} · Nelson +0.30, t 2.53`, tone: o.dvrp_on_dovx.t1 <= -3 ? "down" : o.dvrp_on_dovx.t1 >= 3 ? "up" : "" },
    { label: "ΔVIX on ΔOVX(−1)", value: `b ${signed(o.dvix_on_dovx.b1, 3)}`, delta: `t ${tstat(o.dvix_on_dovx.t1)} · what long vol is paid on` },
    { label: "Δrealised on ΔOVX(−1)", value: `b ${signed(o.drv_on_dovx.b1, 3)}`, delta: `t ${tstat(o.drv_on_dovx.t1)} · realised catches up` },
    { label: `After a ≥ +${o.spike_event.threshold} week`, value: `${signed(o.spike_event.mean_dvrp_after, 2)} pts`, delta: `VRP change, ${o.spike_event.n_events} weeks vs ${signed(o.spike_event.mean_dvrp_other, 2)} otherwise (t ${tstat(o.spike_event.t_dvrp)})` },
    { label: "Sample", value: `${o.n_weeks} weeks`, delta: `weekly, since ${o.since}, Newey-West` },
  ]);
  document.getElementById("vt-ovx-note").textContent = o.verdict || "";
}

async function init() {
  renderShell(); applyChartDefaults();
  try {
    D = await loadJSON("data/vol_strategy.json");
    setAsOf(D.as_of.slice(0, 10));
    header(); checks(); proposal(); verdicts(); backtest();
    document.getElementById("vt-caveat").textContent = D.caveat + (D.backtest ? " " + D.backtest.caveat : "");
    window.addEventListener("themechange", () => { applyChartDefaults(); proposal(); backtest(); });
  } catch (err) { showError(document.getElementById("error"), err); throw err; }
}
init();
