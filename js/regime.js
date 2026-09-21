/* Regime nowcast, the rebalance trigger's verdict, and suggested actions.

   The page deliberately keeps the two layers of the nowcast visually separate.
   Layer A (stress) is estimated from twenty years of data; Layer B (the five
   narratives) is a hand-written score sheet with no track record. Showing them
   in one combined number would launder the second into the first. */

import {
  loadJSON, showError, fmtPct, fmtNum, el, renderTable,
  slotColor, signClass, signed,
} from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const REGIME_LABEL = {
  ai_capex_continues: "AI capex continues",
  ai_digestion: "AI digestion",
  inflation_energy_shock: "Inflation & energy shock",
  disinflation_cuts: "Disinflation & cuts",
  recession: "Recession",
};

const FEATURE_LABEL = {
  vix: "Implied volatility (VIX)",
  credit: "Credit spread (Baa less 10y)",
  turbulence: "Turbulence (Mahalanobis)",
  absorption: "Absorption ratio",
  drawdown: "Drawdown from the 1y high",
  dispersion: "Cross-sectional dispersion",
  curve: "Yield curve, 10y less 2y",
  rate_impulse: "Rate impulse, 63d change in 10y",
  breakeven: "Breakeven inflation, 63d change",
  claims: "Initial jobless claims, 13w change",
  sahm: "Sahm recession indicator",
  ai_lead: "Semis less the index, 63d",
  energy_lead: "Energy less the index, 63d",
  defensive_lead: "Staples less the index, 63d",
};

/* A bar drawn from a token colour, used for both probabilities and z-scores.
   `signed` centres it so a negative reading grows leftward. */
function bar(value, { signed = false, max = 1, slot = 0 } = {}) {
  const pct = Math.min(Math.abs(value) / max, 1) * 100;
  const fill = el("span", {
    class: "bar-fill",
    style: `width:${pct.toFixed(1)}%;background:${slotColor(slot)};` +
           (signed && value < 0 ? "margin-left:auto;" : ""),
  });
  return el("span", {
    class: "bar",
    style: "display:inline-flex;width:100%;max-width:120px;height:8px;" +
           "border-radius:4px;background:var(--line);overflow:hidden;" +
           "vertical-align:middle;",
  }, [fill]);
}

function renderDecision(d) {
  const host = document.getElementById("decision");
  host.innerHTML = "";
  document.getElementById("decision-date").textContent =
    d.days_since != null ? `${d.days_since} days since the last rebalance` : "";

  host.appendChild(el("div", { class: "strip" }, [
    el("div", { class: "stat" }, [
      el("div", { class: "stat-l", text: "Verdict" }),
      el("div", { class: `stat-v ${d.trade ? "down" : "up"}`,
                  text: d.trade ? "TRADE" : "HOLD" }),
      el("div", { class: "stat-d", text: d.trade ? "a trigger fired" : "no trigger fired" }),
    ]),
    el("div", { class: "stat" }, [
      el("div", { class: "stat-l", text: "One-way turnover" }),
      el("div", { class: "stat-v", text: fmtPct(d.turnover, 1) }),
      el("div", { class: "stat-d", text: `to the full target` }),
    ]),
    el("div", { class: "stat" }, [
      el("div", { class: "stat-l", text: "Estimated cost" }),
      el("div", { class: "stat-v", text: `${fmtNum(d.cost_bp, 1)} bp` }),
      el("div", { class: "stat-d", text: "spread only; no commissions" }),
    ]),
    el("div", { class: "stat" }, [
      el("div", { class: "stat-l", text: "Partial adjustment" }),
      el("div", { class: "stat-v", text: fmtPct(d.adjust_fraction, 0) }),
      el("div", { class: "stat-d", text: "of the gap, band-breaching names only" }),
    ]),
  ]));

  const list = (title, items, cls) =>
    items && items.length
      ? el("div", { style: "margin-top:12px" }, [
          el("div", { class: "clabel", text: title }),
          el("ul", { class: "note", style: "margin:4px 0 0 18px" },
            items.map((r) => el("li", { text: r, class: cls || "" }))),
        ])
      : null;

  // append() ignores null; appendChild() throws on it, and an empty
  // blocked_by is the normal case whenever a trigger actually fired.
  host.append(list("Why", d.reasons) || "");
  host.append(list("What is holding it back", d.blocked_by) || "");
  if (d.ce_note) {
    host.appendChild(el("p", { class: "note", style: "margin-top:12px", text: d.ce_note }));
  }
  if (d.regime_note) {
    host.appendChild(el("p", { class: "note", text: `Regime: ${d.regime_note}` }));
  }

  const breached = Object.entries(d.bands_breached || {})
    .sort((a, b) => Math.abs(b[1].gap) - Math.abs(a[1].gap)).slice(0, 8);
  if (breached.length) {
    host.appendChild(el("div", { style: "margin-top:12px" }, [
      el("div", { class: "clabel", text: `Outside the band (${Object.keys(d.bands_breached).length})` }),
      el("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px" },
        breached.map(([t, v]) => el("span", { class: "pill",
          text: `${t} ${fmtPct(v.current, 1)} → ${fmtPct(v.target, 1)}` }))),
    ]));
  }
}

function renderStress(r) {
  const host = document.getElementById("stress");
  host.innerHTML = "";
  const s = r.stress || {};
  if (s.prob == null) {
    host.appendChild(el("p", { class: "note", text: s.note || "Not available." }));
    return;
  }
  host.appendChild(el("div", { class: "strip" }, [
    el("div", { class: "stat" }, [
      el("div", { class: "stat-l", text: "P(stressed)" }),
      el("div", { class: `stat-v ${s.prob > 0.5 ? "down" : "up"}`, text: fmtPct(s.prob, 1) }),
      el("div", { class: "stat-d", text: s.prob > 0.5 ? "high-volatility state" : "calm state" }),
    ]),
    el("div", { class: "stat" }, [
      el("div", { class: "stat-l", text: "Weekly vol, calm" }),
      el("div", { class: "stat-v", text: fmtPct(s.vol_calm_weekly, 2) }),
    ]),
    el("div", { class: "stat" }, [
      el("div", { class: "stat-l", text: "Weekly vol, stressed" }),
      el("div", { class: "stat-v", text: fmtPct(s.vol_stress_weekly, 2) }),
    ]),
    el("div", { class: "stat" }, [
      el("div", { class: "stat-l", text: "Persistence" }),
      el("div", { class: "stat-v", text: `${fmtNum(s.persistence_calm, 2)} / ${fmtNum(s.persistence_stress, 2)}` }),
      el("div", { class: "stat-d", text: "calm / stressed" }),
    ]),
    el("div", { class: "stat" }, [
      el("div", { class: "stat-l", text: "Sample" }),
      el("div", { class: "stat-v", text: String(s.n_weeks) }),
      el("div", { class: "stat-d", text: `weeks, ${fmtPct(s.share_stressed, 0)} stressed` }),
    ]),
  ]));
  host.appendChild(el("p", { class: "note", style: "margin-top:10px",
    text: "Probabilities are filtered, not smoothed: each date uses only data up to " +
          "it. The model's parameters are fitted on the full sample, which is " +
          "reasonable for a live reading and not point-in-time — any backtest of " +
          "this signal must refit on an expanding window." }));
}

function renderRegime(r) {
  const host = document.getElementById("regime");
  host.innerHTML = "";
  const probs = Object.entries(r.regime_probs || {}).sort((a, b) => b[1] - a[1]);

  host.appendChild(el("div", {
    class: `pill ${r.confident ? "" : "warn"}`,
    text: r.confident ? `Leaning ${REGIME_LABEL[r.argmax] || r.argmax}`
                      : "Below the confidence floor — the all-weather book applies",
  }));

  host.appendChild(el("div", { style: "margin-top:12px;display:grid;gap:6px" },
    probs.map(([k, v], i) => el("div", {
      // minmax(0,...) rather than fixed widths: 200+130+60 plus gaps is wider
      // than a 400px phone, and fixed columns cannot shrink below their content.
      style: "display:grid;grid-template-columns:minmax(0,1fr) minmax(60px,120px) 52px;" +
             "align-items:center;gap:10px",
    }, [
      el("span", { text: REGIME_LABEL[k] || k }),
      bar(v, { max: Math.max(0.5, probs[0][1]), slot: i }),
      el("span", { class: "num", text: fmtPct(v, 1) }),
    ]))));

  host.appendChild(el("p", { class: "note", style: "margin-top:12px",
    text: `Entropy ${fmtNum(r.entropy, 2)} (1.00 = no information). ${r.recommendation || ""}` }));
  host.appendChild(el("p", { class: "note", text: r.caveat || "" }));
}

function renderFeatures(r) {
  const rows = Object.entries(r.features_z || {}).map(([k, v]) => ({
    name: FEATURE_LABEL[k] || k,
    z: v,
    raw: (r.features_raw || {})[k],
  }));
  renderTable(document.getElementById("feat-table"), rows, [
    { key: "name", label: "Condition" },
    { key: "z", label: "z", num: true, cls: (r) => signClass(r.z),
      fmt: (v) => signed(v, 2) },
    { key: "z", label: "", fmt: (v) => bar(v, { signed: true, max: 3, slot: v > 0 ? 3 : 1 }) },
    { key: "raw", label: "Reading", num: true,
      fmt: (v) => (v == null ? "—"
        : Math.abs(v) >= 1000 ? Number(v).toLocaleString(undefined, {maximumFractionDigits: 0})
        : fmtNum(v, Math.abs(v) < 1 ? 3 : 2)) },
  ], { sortKey: "z", dir: -1 });
}

function renderActions(a) {
  document.getElementById("actions-note").textContent =
    a && a.suggest_only ? "Suggestions only — nothing here has been executed" : "";
  if (!a) return;

  const rows = (a.actions || []).map((x) => ({
    type: x.type,
    symbol: x.symbol,
    from: x.from_weight,
    to: x.to_weight,
    ret: x.benefit_bp_yr,
    vol: x.d_vol_pp,
    cost: x.cost_bp,
    net: x.net_bp_yr,
    confidence: x.confidence,
    basis: x.confidence_basis,
    triggers: (x.triggers || []).join(", "),
    note: x.note,
  }));
  const actNote = document.getElementById("actions-note");
  if (!rows.length && actNote) {
    actNote.textContent = `Nothing suggested this run${(a.not_taken || []).length
      ? ` — ${a.not_taken.length} candidate(s) were considered and rejected; the table below says why.` : "."}`;
  }
  renderTable(document.getElementById("act-table"), rows, [
    { key: "type", label: "Action", fmt: (v) => el("span", { class: "pill", text: v }) },
    { key: "symbol", label: "Name", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "from", label: "From", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v, 1)) },
    { key: "to", label: "To", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v, 1)) },
    { key: "ret", label: "Δ return", num: true, cls: (r) => signClass(r.ret),
      fmt: (v) => (v == null ? "—" : `${signed(v, 0)} bp`) },
    { key: "vol", label: "Δ vol", num: true,
      fmt: (v) => (v == null ? "—" : `${signed(v, 2)} pp`) },
    { key: "cost", label: "Cost", num: true,
      fmt: (v) => (v == null ? "—" : `${fmtNum(v, 1)} bp`) },
    { key: "net", label: "Net", num: true, cls: (r) => signClass(r.net),
      fmt: (v) => (v == null ? "—" : `${signed(v, 0)} bp`) },
    { key: "confidence", label: "Confidence",
      fmt: (v, r) => el("span", { class: `pill ${v === "low" ? "warn" : ""}`, text: v,
                                  title: r.basis }) },
    // The PROMOTE notes are a couple of sentences. Left on one line they run
    // off the side of the table; wrapping is better than a horizontal scroll
    // for the column that carries the actual reasoning.
    { key: "triggers", label: "Why", cls: () => "wrap", fmt: (v, r) =>
        el("span", { class: "note", text: r.note ? `${v} — ${r.note}` : v }) },
  ], { sortKey: "net", dir: -1 });

  const nt = (a.not_taken || []).map((x) => ({
    type: x.type || "—",
    symbol: x.symbol || "",
    net: x.net_bp_yr,
    reason: x.reason || "",
  }));
  renderTable(document.getElementById("nt-table"), nt, [
    { key: "type", label: "Action" },
    { key: "symbol", label: "Name", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "net", label: "Net", num: true,
      fmt: (v) => (v == null ? "—" : `${signed(v, 0)} bp`) },
    { key: "reason", label: "Why not", cls: () => "wrap",
      fmt: (v) => el("span", { class: "note", text: v }) },
  ]);

  const src = a.sources || {};
  document.getElementById("sources").textContent =
    `Sources — ${Object.entries(src).map(([k, v]) => `${k}: ${v}`).join("; ")}. ` +
    (a.nav_note || "");
}

function renderClusters(port) {
  const host = document.getElementById("clusters");
  if (!host) return;
  host.innerHTML = "";
  const ex = (port && port.cluster_exposure) || {};
  const caps = (port && port.cluster_caps) || {};
  const rows = Object.entries(ex).sort((a, b) => b[1] - a[1]);
  if (!rows.length) { host.appendChild(el("p", { class: "note", text: "No cluster data in this run." })); return; }
  host.appendChild(el("div", { style: "display:grid;gap:6px" }, rows.map(([k, v], i) => {
    const cap = caps[k];
    const near = cap != null && v >= cap - 0.005;
    return el("div", { style: "display:grid;grid-template-columns:minmax(0,1fr) minmax(60px,160px) 110px;align-items:center;gap:10px" }, [
      el("span", { text: k }),
      bar(v, { max: Math.max(0.5, cap || 0.5), slot: near ? 1 : i + 2 }),
      el("span", { class: "num", text: `${fmtPct(v, 1)} / ${cap != null ? fmtPct(cap, 0) : "—"}${near ? " ●" : ""}` }),
    ]);
  })));
  const bits = [];
  if (port.active_share != null) bits.push(`active share vs equilibrium ${fmtPct(port.active_share, 0)}`);
  if (port.vol_band_used) bits.push(`vol band used ${port.vol_band_used.map((x) => fmtPct(x, 0)).join("–")}` +
    (port.p_stressed != null ? ` at P(stressed) ${fmtPct(port.p_stressed, 0)}` : ""));
  if (bits.length) host.appendChild(el("p", { class: "note", style: "margin-top:10px", text: bits.join(" · ") + ". ● = at the cap." }));
}

function renderStressTest(st) {
  const tbl = document.getElementById("stress-table");
  if (!tbl || !st) return;
  const rows = Object.values(st.episodes || {}).map((e) => ({
    label: e.label, book: e.book, dd: e.max_drawdown, spy: e.spy,
    proxied: Object.entries(e.proxied || {}).map(([n, x]) => `${n}→${x}`).join(", ") || "—",
  }));
  renderTable(tbl, rows, [
    { key: "label", label: "Episode" },
    { key: "book", label: "Book", num: true, cls: (r) => signClass(r.book), fmt: (v) => (v == null ? "—" : signed(v * 100, 1) + "%") },
    { key: "dd", label: "Max drawdown", num: true, cls: () => "down", fmt: (v) => (v == null ? "—" : signed(v * 100, 1) + "%") },
    { key: "spy", label: "SPY", num: true, cls: (r) => signClass(r.spy), fmt: (v) => (v == null ? "—" : signed(v * 100, 1) + "%") },
    { key: "proxied", label: "Proxied names", fmt: (v) => el("span", { class: "note", text: v }) },
  ]);
  const c = st.cvar, host = document.getElementById("cvar");
  if (c && host) {
    host.innerHTML = "";
    host.appendChild(el("p", { class: "note", text:
      `Last ${c.n_days} trading days of the actual holdings: VaR95 ${signed(c.var_95_daily * 100, 2)}%/day, ` +
      `CVaR95 ${signed(c.cvar_95_daily * 100, 2)}%/day (${signed(c.cvar_95_annualised * 100, 1)}% annualised), ` +
      `worst day ${signed(c.worst_day * 100, 2)}% on ${c.worst_day_date}. Proxied names borrow their cluster's ETF and are listed, never hidden.` }));
  }
}

async function init() {
  renderShell();
  try {
    const [decision, regime, actions, port, st] = await Promise.all([
      loadJSON("data/decision.json").catch(() => null),
      loadJSON("data/regime.json").catch(() => null),
      loadJSON("data/actions.json").catch(() => null),
      loadJSON("data/portfolio.json").catch(() => null),
      loadJSON("data/stress.json").catch(() => null),
    ]);
    renderClusters(port);
    renderStressTest(st);
    if (regime) {
      setAsOf(regime.as_of);
      renderStress(regime);
      renderRegime(regime);
      renderFeatures(regime);
    }
    if (decision) renderDecision(decision);
    renderActions(actions);
  } catch (err) {
    // Never pass document.body here: showError clears the element it is given,
    // so a body-level handler deletes <main> and every id on the page, turning
    // one bad field into a blank screen with no clue what happened.
    showError(document.getElementById("error"), err);
    throw err;                       // keep it in the console too
  }
}

init();
