/* The options hedge page. Reads docs/data/options.json only. */
import { loadJSON, showError, fmtPct, fmtNum, el, renderTable, signClass } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const signed = (x, dp = 0) => (x == null ? "—" : (x >= 0 ? "+" : "\u2212") + Math.abs(x).toFixed(dp));
const pct = (x, dp = 1) => (x == null ? "—" : fmtPct(x, dp));

function stat(label, value, delta, tone) {
  return el("div", { class: "stat" }, [
    el("div", { class: "stat-l", text: label }),
    el("div", { class: `stat-v ${tone || ""}`.trim(), text: value }),
    delta ? el("div", { class: "stat-d", text: delta }) : null,
  ]);
}

function renderProposal(d) {
  const host = document.getElementById("proposal"); host.innerHTML = "";
  const p = d.proposal || {}, sz = d.size || {}, bud = d.budget || {};
  const kind = p.kind || "NONE";
  document.getElementById("prop-note").textContent = d.suggest_only ? "Suggestions only — nothing here is executed" : "";
  host.appendChild(el("div", { class: "strip" }, [
    stat("Proposal", kind, p.note ? "" : (kind === "NONE" ? "no hedge" : ""), kind === "OPEN" || kind === "ROLL" ? "down" : "up"),
    stat("Structure", d.structure || "—", `IV rank ${fmtNum((d.cone || {}).iv_rank_1y, 2)}`),
    stat("Contracts / $100k", sz.contracts_per_100k == null ? "—" : fmtNum(sz.contracts_per_100k, 2),
         d.feasible_at_current_nav ? "feasible at current size" : "below minimum lot at current size",
         d.feasible_at_current_nav ? "up" : "down"),
    stat("Cost now", bud.premium_bp == null ? "—" : `${fmtNum(bud.premium_bp, 0)} bp`,
         bud.annualised_bp == null ? "" : `${fmtNum(bud.annualised_bp, 0)} bp/yr annualised`),
  ]));
  if (p.note) host.appendChild(el("p", { class: "note", style: "margin-top:10px", text: p.note }));
  const rows = (p.legs || []).map((l) => ({ side: l.side > 0 ? "LONG" : "SHORT", sym: l.underlying, expiry: l.expiry,
    strike: l.strike, right: l.right === "P" ? "put" : "call", mid: l.mid, delta: l.delta, iv: l.iv }));
  renderTable(document.getElementById("legs-table"), rows, [
    { key: "side", label: "Side", fmt: (v) => el("span", { class: `pill ${v === "SHORT" ? "warn" : ""}`, text: v }) },
    { key: "sym", label: "Underlying", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "expiry", label: "Expiry" },
    { key: "strike", label: "Strike", num: true, fmt: (v) => fmtNum(v, 0) },
    { key: "right", label: "Right" },
    { key: "mid", label: "Mid", num: true, fmt: (v) => fmtNum(v, 2) },
    { key: "delta", label: "Delta", num: true, fmt: (v) => signed(v, 2) },
    { key: "iv", label: "IV", num: true, fmt: (v) => pct(v, 1) },
  ]);
}

function renderSignal(d) {
  const host = document.getElementById("signal"); host.innerHTML = "";
  const s = d.signal || {}; const fired = new Set(s.fired || []);
  const trig = (name, label, value, thr) => stat(label, value,
    `${fired.has(name) ? "FIRED" : "quiet"} · threshold ${thr}`, fired.has(name) ? "down" : "up");
  host.appendChild(el("div", { class: "strip" }, [
    stat("State", s.state || "—", `${(s.fired || []).length} of ${s.required || 2} needed`, s.state === "ON" ? "down" : "up"),
    trig("stress", "P(stressed)", pct(s.p_stressed, 1), "≥ 50%"),
    trig("term_structure", "VIX / VIX3M", fmtNum(s.term_ratio, 2), "≥ 1.00"),
    trig("drawdown", "SPY drawdown, 63d", pct(s.drawdown_63d, 1), "≤ −5%"),
  ]));
}

function renderSurface(d) {
  const host = document.getElementById("surface"); host.innerHTML = "";
  const s = d.surface || {}, c = d.cone || {}, q = d.data_quality || {};
  document.getElementById("surf-note").textContent = `${d.underlying} spot ${fmtNum(d.spot, 2)} · ${q.n_ok} usable quotes`;
  host.appendChild(el("div", { class: "strip" }, [
    stat("ATM IV 30d", pct(s.atm_iv_30, 1), `60d ${pct(s.atm_iv_60, 1)}`),
    stat("25Δ skew", s.skew_25d_30 == null ? "—" : `${signed(s.skew_25d_30 * 100, 1)} pts`, "put IV minus call IV"),
    stat("Term 30/90", fmtNum(s.term_ratio_30_90, 2), s.term_ratio_30_90 > 1 ? "inverted" : "contango"),
    stat("IV rank, 1y", fmtNum(c.iv_rank_1y, 2), `percentile ${fmtNum(c.iv_pct_1y, 2)} · on ${c.rank_source || "—"}`),
    stat("IV − realised 21d", c.iv_minus_rv21 == null ? "—" : `${signed(c.iv_minus_rv21 * 100, 1)} pts`, "the premium being paid"),
  ]));
}

function renderBeta(d) {
  const b = d.beta || {};
  const rows = Object.entries(b.names || {}).map(([k, v]) => ({ name: k, beta: v }));
  renderTable(document.getElementById("beta-table"), rows, [
    { key: "name", label: "Name", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "beta", label: "Beta vs SPY", num: true, cls: (r) => (r.beta > 1.3 ? "down" : ""), fmt: (v) => fmtNum(v, 2) },
  ], { sortKey: "beta", dir: -1 });
  const th = document.querySelector("#beta-table thead tr");
  if (th && b.book != null) th.insertAdjacentElement("afterend",
    el("tr", {}, [el("th", { text: "BOOK" }), el("th", { class: "num", text: `${fmtNum(b.book, 2)} → target ${fmtNum(b.target, 2)}` })]));
}

function renderBudget(d) {
  const host = document.getElementById("budget"); host.innerHTML = "";
  const bud = d.budget || {}, q = d.data_quality || {};
  host.appendChild(el("div", { class: "strip" }, [
    stat("Budget", bud.cap_bp_yr == null ? "—" : `${fmtNum(bud.cap_bp_yr, 0)} bp/yr`, `used ${fmtNum(bud.spent_ytd_bp || 0, 0)} bp`),
    stat("Data", q.source || "—", q.delayed ? `delayed ${q.delayed} min` : "real-time"),
    stat("Flags", Object.entries(q.flags || {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "—", `snapshot ${fmtNum(q.snapshot_age_h, 1)} h old`),
    stat("Covered calls", (d.covered_call_candidates || []).join(", ") || "none eligible", "at cap, not FIXED/FLOORS, ≥100 sh"),
  ]));
}

const MODE_LABEL = { never: "Never hedged", always: "Always hedged, no cap", triggered: "Gated, no cap", policy: "Gated + budget cap (the policy)" };

function renderBacktest(d) {
  const bt = d.backtest_summary; const host = document.getElementById("bt-summary"); host.innerHTML = "";
  if (!bt || !bt.summary) { document.getElementById("bt-note").textContent = "no backtest yet"; return; }
  const s = bt.summary, pol = s.policy || {}, trig = s.triggered || {};
  document.getElementById("bt-note").textContent =
    `synthetic option prices, ${bt.start} → ${bt.as_of} · skew ${fmtNum(bt.skew_pts * 100, 0)} pts fixed · beta ${fmtNum(bt.beta, 2)} proxy`;
  host.appendChild(el("div", { class: "strip" }, [
    stat("Beta cut the cap funds", pol.beta_cut_funded == null ? "—" : `−${fmtNum(pol.beta_cut_funded, 2)}`,
         `of −${fmtNum(bt.beta - (d.beta || {}).target, 2)} targeted · ${pct(pol.coverage, 0)} of sized contracts`, pol.coverage < 0.5 ? "down" : "up"),
    stat("Calm-year drag, policy", pol.calm_year_drag_bp == null ? "—" : `${signed(pol.calm_year_drag_bp, 0)} bp/yr`, `gated, uncapped: ${signed(trig.calm_year_drag_bp, 0)} bp/yr`),
    stat("Opens blocked by cap", pol.n_blocked == null ? "—" : `${pol.n_blocked} of ${pol.n_blocked + pol.n_opens}`, "rolls the gate wanted"),
  ]));
  const rows = Object.entries(s).map(([m, v]) => ({ mode: MODE_LABEL[m] || m, unh: v.total_return.unhedged, hed: v.total_return.hedged,
    drag: v.calm_year_drag_bp, prem: v.avg_premium_bp_yr, opens: v.n_opens, cov: v.coverage }));
  renderTable(document.getElementById("bt-table"), rows, [
    { key: "mode", label: "Mode" },
    { key: "unh", label: "Unhedged, total", num: true, fmt: (v) => pct(v, 0) },
    { key: "hed", label: "Hedged, total", num: true, cls: (r) => signClass(r.hed - r.unh), fmt: (v) => pct(v, 0) },
    { key: "drag", label: "Calm-year drag", num: true, fmt: (v) => (v == null ? "—" : `${signed(v, 0)} bp`) },
    { key: "prem", label: "Premium / yr", num: true, fmt: (v) => `${fmtNum(v, 0)} bp` },
    { key: "opens", label: "Opens", num: true },
    { key: "cov", label: "Funded", num: true, fmt: (v) => pct(v, 0) },
  ]);
  const eps = Object.keys((s.never || {}).episodes || {});
  const erows = eps.map((k) => { const r = { ep: s.never.episodes[k].label, unh: s.never.episodes[k].unhedged };
    for (const m of Object.keys(s)) r[m] = (s[m].episodes[k] || {}).hedged; return r; });
  renderTable(document.getElementById("ep-table"), erows, [
    { key: "ep", label: "Episode" },
    { key: "unh", label: "Unhedged", num: true, fmt: (v) => pct(v, 1) },
    ...Object.keys(s).filter((m) => m !== "never").map((m) => ({ key: m, label: MODE_LABEL[m], num: true,
      cls: (r) => signClass((r[m] ?? r.unh) - r.unh), fmt: (v) => pct(v, 1) })),
  ]);
}

async function init() {
  renderShell();
  try {
    const d = await loadJSON("data/options.json");
    setAsOf(d.as_of);
    renderProposal(d); renderSignal(d); renderSurface(d); renderBeta(d); renderBacktest(d); renderBudget(d);
    document.getElementById("caveat").textContent = d.caveat || "";
  } catch (err) {
    showError(document.getElementById("error"), err);
    throw err;
  }
}
init();
