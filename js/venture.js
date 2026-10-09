/* Venture screen: the ETF-sourced small-cap candidates, ranked by evidence
   weight with the base rates of their profile printed beside them. Momentum,
   volume and attention are shown as context; the page says what is and is
   not established, because the data does. */

import { loadJSON, showError, fmtPct, el, renderTable, base, renderStats, fmtDay, tok, breakdownColors } from "./common.js";
import { draw, lineConfig } from "./charts.js";
import { renderShell, setAsOf, registerCommands } from "./shell.js";

let DATA = null, sortKey = "rank", onlyFlag = null;

const num = (v, dp = 2) => (v == null ? "—" : Number(v).toFixed(dp));
const pct = (v, dp = 0) => (v == null ? "—" : fmtPct(v, dp));
const money = (v) => (v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}bn` : `$${(v / 1e6).toFixed(0)}m`);
const GRADE_CLASS = {
  "strong (literature), untested here": "up", moderate: "up", "moderate (literature)": "up",
  suggestive: "", weak: "", context: "muted", macro: "down", contrarian: "down", "NEGATIVE here": "down",
};
const NEG = new Set(["CROWDED", "FRAGILE", "DOWNGRADED", "LOSER", "PRE_RUN"]);

function flagPill(f) {
  const ev = DATA.evidence.find((e) => e.key === f);
  const cls = NEG.has(f) ? "pill down" : (ev && ev.weight > 0 ? "pill up" : "pill muted");
  return el("span", { class: cls, title: ev ? `${ev.label} · ${ev.grade} · weight ${ev.weight}` : f, text: f });
}

function headline() {
  const u = DATA.universe, port = DATA.portfolio;
  const stat = (l, v, d) => el("div", { class: "stat" }, [
    el("div", { class: "stat-l", text: l }), el("div", { class: "stat-v", text: v }),
    d ? el("div", { class: "stat-d", text: d }) : null].filter(Boolean));
  const host = document.getElementById("headline");
  host.replaceChildren(
    stat("ETFs swept", String(u.etfs), `top ${10} each`),
    stat("Names", String(u.names), `${u.small} still small`),
    stat("Screened", String(DATA.rows.length), `panel as of ${DATA.panel_as_of || "—"}`),
    stat("Portfolio", String(port.length), "equal weight, unfunded"),
    stat("Established signals", "0", "at |t| ≥ 3 in the panel"),
  );
}

function macro() {
  const m = DATA.macro;
  const host = document.getElementById("macro");
  host.replaceChildren(
    el("p", { text: m.summary }),
    el("ul", {}, m.points.map((p) => el("li", { text: p }))),
    el("p", { class: "note" }, [
      el("span", { text: `Snapshot ${m.as_of}. Sources: ` }),
      ...m.sources.flatMap((s, i) => [
        el("a", { href: s.url, target: "_blank", rel: "noopener", text: s.title }),
        i < m.sources.length - 1 ? el("span", { text: " · " }) : null]).filter(Boolean),
    ]),
  );
}

function evidence() {
  const rows = DATA.evidence.map((e) => ({ ...e, sources_txt: (e.sources || []).join("; ") }));
  renderTable(document.getElementById("ev-table"), rows, [
    { key: "key", label: "Flag", fmt: (v) => el("code", { text: v }) },
    { key: "label", label: "Signal" },
    { key: "grade", label: "Evidence", fmt: (v) => el("span", { class: `pill ${GRADE_CLASS[v] || ""}`, text: v }) },
    { key: "weight", label: "Weight", num: true, fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1) },
    { key: "note", label: "What it means here", cls: () => "wrap" },
    { key: "sources_txt", label: "Sources", cls: () => "wrap note" },
  ]);
}

function baseRates() {
  const b = DATA.base_rates, t = DATA.base_tests || {};
  const rows = Object.entries(b).map(([k, v]) => ({
    key: k, label: v.label,
    m3: v.fwd3?.mean, m6: v.fwd6?.mean, m12: v.fwd12?.mean,
    dbl: v.fwd12?.p_double, hlv: v.fwd12?.p_halve, n: v.fwd12?.n,
    t3: t[k]?.fwd3?.t, t12: t[k]?.fwd12?.t, verdict: t[k]?.fwd12?.verdict || (k === "all" ? "—" : "noise"),
  }));
  renderTable(document.getElementById("br-table"), rows, [
    { key: "label", label: "Profile" },
    { key: "m3", label: "3m", num: true, fmt: (v) => pct(v, 1) },
    { key: "m6", label: "6m", num: true, fmt: (v) => pct(v, 1) },
    { key: "m12", label: "12m", num: true, fmt: (v) => pct(v, 1) },
    { key: "dbl", label: "Doubled", num: true, fmt: (v) => pct(v, 1) },
    { key: "hlv", label: "Halved", num: true, fmt: (v) => pct(v, 1) },
    { key: "n", label: "n", num: true, fmt: (v) => (v == null ? "—" : v.toLocaleString()) },
    { key: "t12", label: "t (12m)", num: true, fmt: (v) => num(v, 2) },
    { key: "verdict", label: "Verdict", fmt: (v) => el("span", { class: `pill ${v === "established" ? "up" : v === "suggestive" ? "" : "muted"}`, text: v }) },
  ]);
}

function screenRows() {
  let rows = DATA.rows.map((r) => ({ ...r, flags_n: r.flags.length }));
  if (onlyFlag) rows = rows.filter((r) => r.flags.includes(onlyFlag));
  return rows;
}

function paint() {
  const rows = screenRows();
  const dir = sortKey === "rank" ? 1 : -1;
  rows.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir;
  });
  document.getElementById("count").textContent = `${rows.length} names` + (onlyFlag ? ` with ${onlyFlag}` : "");
  renderTable(document.getElementById("sc-table"), rows, [
    { key: "rank", label: "#", num: true },
    { key: "symbol", label: "Sym", fmt: (v, r) => {
        const a = el("a", { href: "#", class: "sym", text: v });
        a.addEventListener("click", (e) => { e.preventDefault(); detail(r); });
        return a;
      } },
    { key: "name", label: "Company", fmt: (v) => el("span", { class: "muted", text: (v || "").slice(0, 28) }) },
    { key: "score", label: "Score", num: true, fmt: (v) => el("b", { text: num(v, 1) }) },
    { key: "mcap", label: "Cap", num: true, fmt: money },
    { key: "pth", label: "÷52w hi", num: true, fmt: (v) => num(v, 2) },
    { key: "mom_12_1", label: "Mom 12-1", num: true, fmt: (v) => pct(v) },
    { key: "vol_surge", label: "Vol surge", num: true, fmt: (v) => (v == null ? "—" : v.toFixed(2) + "×") },
    { key: "sue", label: "SUE", num: true, fmt: (v) => num(v, 1) },
    { key: "gp_a", label: "GP/A", num: true, fmt: (v) => num(v, 2) },
    { key: "insider_buys_90d", label: "Ins. buys", num: true },
    { key: "target_upside", label: "Street", num: true, fmt: (v) => pct(v) },
    { key: "spike_z", label: "Attn z", num: true, fmt: (v) => num(v, 1) },
    { key: "base_p_double", label: "P(2×)", num: true, fmt: (v) => pct(v, 1) },
    { key: "base_p_halve", label: "P(½)", num: true, fmt: (v) => pct(v, 1) },
    { key: "flags_n", label: "Flags", cls: () => "vx-flags-cell", fmt: (_, r) => el("span", { class: "flags" }, r.flags.map(flagPill)) },
  ]);
}

function portfolio() {
  const host = document.getElementById("portfolio");
  const port = DATA.portfolio;
  if (!port.length) { host.replaceChildren(el("p", { class: "note", text: "No name scored above zero." })); return; }
  const rows = port.map((p) => {
    const r = DATA.rows.find((x) => x.symbol === p.symbol) || {};
    return { ...p, name: r.name, profile: r.profile_label, dbl: r.base_p_double, hlv: r.base_p_halve, flags: r.flags || [] };
  });
  renderTable(document.getElementById("pf-table"), rows, [
    { key: "rank", label: "#", num: true },
    { key: "symbol", label: "Sym", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "name", label: "Company", fmt: (v) => (v || "").slice(0, 30) },
    { key: "weight", label: "Weight", num: true, fmt: (v) => pct(v, 1) },
    { key: "score", label: "Score", num: true, fmt: (v) => num(v, 1) },
    { key: "profile", label: "Panel profile" },
    { key: "dbl", label: "P(2×) 12m", num: true, fmt: (v) => pct(v, 1) },
    { key: "hlv", label: "P(½) 12m", num: true, fmt: (v) => pct(v, 1) },
    { key: "flags", label: "Why", fmt: (v) => el("span", { class: "flags" }, v.filter((f) => !NEG.has(f)).map(flagPill)) },
  ]);
}

async function pitches() {
  const host = document.getElementById("pitches");
  let idx = null;
  try { idx = await loadJSON("data/venture_pitches.json"); } catch { /* none built yet */ }
  if (!idx || !idx.pitches.length) {
    host.replaceChildren(el("p", { class: "note", text: "No pitch has been written yet. A pitch is a researched thesis, not a generated one — see venture/theses.py." }));
    return;
  }
  host.replaceChildren(
    ...idx.pitches.map((p) => el("div", { class: "vx-pitch" }, [
      el("a", { class: "sym", href: base() + p.path, target: "_blank", rel: "noopener", text: p.symbol }),
      el("span", { class: "vx-pitch-call", text: p.call }),
      el("a", { class: "vx-pitch-pdf", href: base() + p.path, target: "_blank", rel: "noopener", text: "Open PDF ↗" }),
    ])),
    idx.without_thesis.length
      ? el("p", { class: "note", text: `In the portfolio without a written thesis, so no PDF: ${idx.without_thesis.join(", ")}.` })
      : null,
  );
}

function themes() {
  const host = document.getElementById("themes");
  host.replaceChildren(...Object.entries(DATA.themes).filter(([, t]) => t.names.length).map(([k, t]) =>
    el("div", { class: "vx-theme" }, [
      el("span", { class: "vx-theme-l", text: t.label }),
      el("span", { class: "vx-theme-names" }, t.names.map((s) => el("span", { class: "chip", text: s }))),
    ])));
  if (!host.children.length) host.replaceChildren(el("p", { class: "note", text: "No candidate matches an emerging-industry keyword." }));
}

function detail(r) {
  const box = document.getElementById("detail");
  box.innerHTML = "";
  const kv = (l, v) => el("div", { class: "stat" }, [el("div", { class: "stat-l", text: l }), el("div", { class: "stat-v", text: v })]);
  const f13 = r.f13;
  box.append(el("div", { class: "panel" }, [
    el("div", { class: "panel-h" }, [
      el("h2", { text: `${r.symbol} · ${r.name || ""}` }), el("span", { class: "spacer" }),
      el("span", { class: "note", text: `${r.sector || ""} · ${r.industry || ""}` })]),
    el("div", { class: "panel-b" }, [
      el("div", { class: "grid" }, [
        kv("Score", num(r.score, 1)), kv("Rank", String(r.rank)),
        kv("Price", r.price == null ? "—" : `$${r.price.toFixed(2)}`), kv("Market cap", money(r.mcap)),
        kv("÷ 52w high", num(r.pth, 2)), kv("Days since high", r.days_since_high == null ? "—" : String(r.days_since_high)),
        kv("1m / 3m / 6m / 12m", [r.ret_1m, r.ret_3m, r.ret_6m, r.ret_12m].map((v) => pct(v)).join(" / ")),
        kv("Vol (ann.)", pct(r.vol_ann)), kv("Volume surge", r.vol_surge == null ? "—" : r.vol_surge.toFixed(2) + "×"),
        kv("Last EPS surprise", pct(r.eps_surprise, 1)), kv("SUE", num(r.sue, 2)),
        kv("Beat streak", r.beat_streak == null ? "—" : `${r.beat_streak} (${r.beats_of_8 ?? "—"}/8)`),
        kv("Next report", r.next_earnings ? `${r.next_earnings} (${r.days_to_earnings}d)` : "—"),
        kv("Insider buys 90d", `${r.insider_buys_90d ?? 0} by ${r.insider_buyers_90d ?? 0}${r.insider_cluster ? " · CLUSTER" : ""}`),
        kv("Insider sells 90d", String(r.insider_sells_90d ?? 0)),
        kv("Analysts", `${r.n_analysts ?? 0} · ${r.consensus || "—"}`), kv("Street upside", pct(r.target_upside)),
        kv("Up / down / init 90d", `${r.grades_up_90d ?? 0} / ${r.grades_down_90d ?? 0} / ${r.initiations_90d ?? 0}`),
        kv("GP/A", num(r.gp_a, 2)), kv("Gross margin", pct(r.gross_margin)), kv("Rev growth TTM", pct(r.revenue_growth)),
        kv("Profitable", r.profitable == null ? "—" : r.profitable ? "yes" : "no"), kv("FCF", r.fcf_positive == null ? "—" : r.fcf_positive ? "positive" : "negative"),
        kv("Net debt / EBITDA", num(r.net_debt_to_ebitda, 1)), kv("Altman Z", num(r.altman_z, 1)), kv("Piotroski", num(r.piotroski, 0)),
        kv("Free float", pct(r.free_float_pct == null ? null : r.free_float_pct / 100)),
        kv("Attention z", num(r.spike_z, 1)), kv("Articles 30d", String(r.articles_30d ?? "—")),
        kv("Panel bucket", r.panel_bucket || "outgrew the panel"), kv("Panel SUE / GP/A pct", `${num(r.panel_sue_q, 2)} / ${num(r.panel_gpa_q, 2)}`),
        kv("In ETFs", (r.etfs || []).join(", ")),
      ]),
      el("p", { class: "note" }, [el("b", { text: "Profile: " }), el("span", { text: `${r.profile_label || r.profile}. ` }),
        el("span", { text: `Names with this profile since 2013: mean 12m ${pct(r.base_fwd12_mean, 1)}, doubled ${pct(r.base_p_double, 1)}, halved ${pct(r.base_p_halve, 1)}.` })]),
      el("div", { class: "flags" }, r.flags.map(flagPill)),
      r.themes && r.themes.length ? el("p", { class: "note", text: "Themes: " + r.themes.map((t) => DATA.themes[t]?.label || t).join(", ") }) : null,
      f13 ? el("p", { class: "note", text: `13F: held by ${f13.holders.map((h) => `${h.fund} (${fmtPct(h.weight, 1)})`).join(", ")}` + (f13.best_idea_for.length ? ` · best idea for ${f13.best_idea_for.join(", ")}` : "") }) : null,
      r.mention_titles && r.mention_titles.length ? el("ul", { class: "note" }, r.mention_titles.map((t) => el("li", { text: t }))) : null,
      r.description ? el("p", { class: "prose", text: r.description }) : null,
    ].filter(Boolean)),
  ]));
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function wire() {
  document.getElementById("sortby").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#sortby button").forEach((x) => x.classList.toggle("active", x === b));
    sortKey = b.dataset.sort; paint();
  });
  document.getElementById("flagfilter").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#flagfilter button").forEach((x) => x.classList.toggle("active", x === b));
    onlyFlag = b.dataset.flag || null; paint();
  });
}

/* ---------- labels ---------- */

const RULE_NAMES = {
  reversal_3d: "Short-term reversal", news_breakout: "News breakout", news_momentum: "News momentum",
  breakout_volume: "Volume breakout", gap_and_go: "Gap and go", fade_newsless_drop: "Fade a news-less drop",
  pullback_uptrend: "Pullback in an uptrend", golden_cross: "50/200 EMA golden cross",
  golden_cross_pullback: "Pullback above a golden cross", news_momentum_trend: "News momentum in an uptrend",
  breakout_trend: "Breakout in an uptrend", fade_newsless_spike: "News-less spike (control)",
  pairs_long_laggard: "Pairs: buy the laggard", pairs_hedged: "Pairs: long/short (control)",
};
const ruleName = (k) => RULE_NAMES[k] || k;

/* "multi_day/3d<=-10% | none | hold 10" -> "3-day fall of 10% or more · hold 10 sessions" */
function labRule(code) {
  const [sig, flt, hold] = code.split(" | ");
  const parts = sig.split("/");
  let what = sig;
  const m = (re) => sig.match(re);
  let x;
  if ((x = m(/multi_day\/(\d)d<=-(\d+)%/))) what = `${x[1]}-day fall of ${x[2]}% or more`;
  else if ((x = m(/multi_day\/(\d)d>=(\d+)%/))) what = `${x[1]}-day rise of ${x[2]}% or more`;
  else if ((x = m(/day_down\/r1<=-(\d+)%\/vol>=([\d.]+)/))) what = `1-day fall of ${x[1]}% or more` + (+x[2] > 1 ? ` on ${x[2]}× volume` : "");
  else if ((x = m(/day_up\/r1>=(\d+)%\/vol>=([\d.]+)/))) what = `1-day rise of ${x[1]}% or more` + (+x[2] > 1 ? ` on ${x[2]}× volume` : "");
  else if ((x = m(/breakout\/hi(\d+)\/vol>=([\d.]+)/))) what = `${x[1]}-day high` + (+x[2] > 1 ? ` on ${x[2]}× volume` : "");
  void parts;
  const when = { none: "", above50: " · above the 50-day", ema_up: " · 50 EMA over 200", spy_up: " · SPY above its 200-day", vix_low: " · VIX under 20" }[flt] ?? ` · ${flt}`;
  return `${what}${when} · hold ${(hold || "").replace("hold ", "")} sessions`;
}

const FLAG_LABELS = { SUE_TOP: "earnings surprise", INSIDER_BUY: "insider buying", INSIDER_CLUSTER: "insider cluster",
  QUALITY_NEAR_HIGH: "quality near its high", QUIET_STRENGTH: "quiet strength", SMALLCAP_TOP: "small-cap screen",
  BEST_IDEA: "a fund's best idea", HELD_BY_FUNDS: "held by funds", INITIATED: "analyst initiation" };
const flagLabel = (f) => FLAG_LABELS[f]
  || ((typeof DATA !== "undefined" && DATA?.evidence) || []).find((e) => e.key === f)?.label?.replace(/^./, (c) => c.toLowerCase())
  || f.toLowerCase().replace(/_/g, " ");
/* sma150_buf2 -> "150-day average, 2% band"; ema50x200 -> "50/200-day EMA cross"; sma10m_monthly -> "10-month average". */
function trendName(k) {
  let x;
  if ((x = /^sma(\d+)_buf(\d+)$/.exec(k || ""))) return `${x[1]}-day average` + (+x[2] ? `, ${x[2]}% band` : "");
  if ((x = /^ema(\d+)x(\d+)$/.exec(k || ""))) return `${x[1]}/${x[2]}-day EMA cross`;
  if (k === "sma10m_monthly") return "10-month average, checked monthly";
  return k;
}

/* ---------- the thesis and the universe (venture/thesis.py, venture/theme.py) ---------- */

let VT = null;

function thesis() {
  const T = VT?.thesis, art = document.getElementById("vx-thesis");
  if (!T) { if (art) art.hidden = true; return; }
  document.getElementById("vx-title").textContent = T.title;
  document.getElementById("vx-dek").textContent = T.dek;
  document.getElementById("vx-by").textContent = `${T.author} · ${fmtDay(T.date)} · an opinion with a scenario attached, not a forecast`;
  const body = document.getElementById("vx-body"); body.innerHTML = "";
  for (const [h, paras] of T.sections) {
    body.appendChild(el("h2", { text: h }));
    paras.forEach((t) => body.appendChild(el("p", { text: t })));
  }
  // The scenario as stacked cards: a three-column table does not fit beside the essay.
  const P = T.projections, proj = document.getElementById("vx-proj"); proj.innerHTML = "";
  P.rows.forEach(([what, now, then]) => proj.appendChild(el("div", { class: "vx-card" }, [
    el("div", { class: "vx-card-h", text: what }),
    el("div", { class: "vx-card-row" }, [el("span", { class: "vx-card-l", text: "2026" }), el("span", { text: now })]),
    el("div", { class: "vx-card-row then" }, [el("span", { class: "vx-card-l", text: "2030" }), el("span", { text: then })]),
  ])));
  document.getElementById("vx-proj-cap").textContent = P.caption;
  const src = document.getElementById("vx-src"); src.innerHTML = "";
  T.sources.forEach(([label, url]) => src.appendChild(el("li", {}, [
    el("a", { href: /^https?:/.test(url) ? url : base() + url, target: /^https?:/.test(url) ? "_blank" : null, rel: "noopener", text: label })])));
}

function universe() {
  if (!VT) return;
  const rows = VT.rows.map((r) => ({ ...r, purity: r.exposure?.purity, growthv: r.revenue_growth }));
  const held = new Set((VB?.positions || []).map((p) => p.symbol));
  renderTable(document.getElementById("vu-table"), rows.slice(0, 60), [
    { key: "rank", label: "#", num: true },
    { key: "symbol", label: "Stock", fmt: (v, r) => el("span", { class: "tk-sym" }, [el("span", { class: "sym", text: v, title: r.name || "" }),
        held.has(v) ? el("span", { class: "pill on", text: "held" }) : null]) },
    { key: "pillar_label", label: "Pillar" },
    { key: "purity", label: "Purity", num: true, fmt: (v) => (v == null ? "–" : `${Math.round(v * 100)}%`) },
    { key: "growthv", label: "Revenue growth", num: true, fmt: (v) => sp(v, 0) },
    { key: "mcap", label: "Market cap", num: true, fmt: (v) => (v == null ? "–" : v >= 1e9 ? `US$${(v / 1e9).toFixed(1)}bn` : `US$${(v / 1e6).toFixed(0)}m`) },
    { key: "flags_evidence", label: "Evidence", fmt: (v) => el("span", { class: "note", text: (v || []).map(flagLabel).join(", ") || "–" }) },
    { key: "theme_score", label: "Score", num: true, fmt: (v) => v.toFixed(2) },
  ], { sortKey: "rank", dir: 1 });
  const U = VT.universe;
  document.getElementById("vu-meta").textContent = `${U.ranked} ranked of ${U.members} ETF holdings · top 60 shown`;
  document.getElementById("vu-note").textContent =
    `Candidates are every US-listed holding of ${Object.keys(VT.etfs).join(", ")} (their latest SEC N-PORT filings), worth at least ` +
    `US$${VT.rules.min_mcap / 1e6}m. Purity is the share of the company's own 10-K business description (or profile, for a foreign filer) ` +
    `that names the thesis; a company needs ${VT.rules.min_purity * 100}%. Score = ${Object.entries(VT.weights).map(([k, w]) => `${w} ${k}`).join(" + ")}, ` +
    "each a percentile in the universe; convexity is the inverse of size, the tilt to pure plays. The weights are the author's and untested.";
}

/* ---------- the swing sleeve (venture/swing.py, venture/book.py) ---------- */

function swingPanel() {
  const W = VB?.swing, panel = document.getElementById("sw-panel");
  if (!W) { if (panel) panel.hidden = true; return; }
  const S = W.stats;
  document.getElementById("sw-meta").textContent = `up to ${W.max_open} trades of ${(W.slot * 100).toFixed(0)}% · the thesis core is ${(W.core_share * 100).toFixed(0)}% of the book`;
  renderStats("sw-strip", [
    { label: "Open swing trades", value: String(W.open.length), delta: W.orders.length ? `${W.orders.length} to buy at the next open` : "no orders pending" },
    { label: "Closed", value: String(S.n), delta: S.win == null ? "none yet" : `${Math.round(S.win * 100)}% winners` },
    { label: "Average trade", value: S.mean == null ? "–" : sp(S.mean, 2), tone: tn(S.mean) },
    { label: "Swing P&L", value: usd(S.pnl), tone: tn(S.pnl), delta: "paper, no fees" },
    { label: "Rules trading", value: String(W.live_rules.length), delta: W.live_rules.map(ruleName).join(", ") || "none passed the test" },
  ]);
  const rows = [...W.open.map((t) => ({ ...t, status: "open" })),
                ...W.orders.map((o) => ({ symbol: o.symbol, rule: o.rule, status: "buy at open", entry_date: o.placed })),
                ...W.closed.slice(0, 15).map((c) => ({ ...c, status: c.why, gain: c.ret, last: c.exit }))];
  const empty = document.getElementById("sw-empty"), openWrap = document.getElementById("sw-open").closest(".panel-b");
  empty.hidden = rows.length > 0;
  openWrap.hidden = rows.length === 0;
  empty.textContent = rows.length ? "" : `No swing trades yet. Each evening the rules are checked at the close; a signal becomes an order ` +
    `for the next open. ${W.live_rules.length ? `Trading now: ${W.live_rules.map(ruleName).join(", ")}.` : "No rule is trading."}`;
  renderTable(document.getElementById("sw-open"), rows, [
    { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "rule", label: "Rule", fmt: (v) => el("span", { class: "note", text: v }) },
    { key: "status", label: "Status", fmt: (v) => el("span", { class: `pill ${v === "target" ? "up" : v === "stop" ? "down" : v === "open" ? "on" : "muted"}`, text: v }) },
    { key: "entry_date", label: "Entered", fmt: (v) => el("span", { class: "tk-date", text: v || "–" }) },
    { key: "entry", label: "Entry", num: true, fmt: (v) => (v == null ? "–" : usd(v, 2)) },
    { key: "stop", label: "Stop", num: true, fmt: (v) => (v == null ? "–" : usd(v, 2)) },
    { key: "target", label: "Target", num: true, fmt: (v) => (v == null ? "–" : usd(v, 2)) },
    { key: "gain", label: "Return", num: true, fmt: (v) => (v == null ? "–" : el("span", { class: `tk-vs ${tn(v)}`, text: sp(v, 1) })) },
  ]);
  const B = W.backtest || {}, live = new Set(W.live_rules || []);
  const adopted = Object.entries(W.adopted || {}).map(([k, v]) => ({ key: k, rule: v.lab_rule, hold_days: 10,
    in_mean: v.in_sample.mean, out_mean: v.out_of_sample.mean, out_t: v.out_of_sample.t, out_n: v.out_of_sample.n,
    out_win: v.out_of_sample.win, trades_live: live.has(k), source: "14 years, 4,549 small caps" }));
  const bt = adopted.concat(Object.entries(B).filter(([k]) => !(W.adopted || {})[k]).map(([k, v]) => ({ key: k, ...v,
    in_mean: v.in_sample.mean, out_mean: v.out_of_sample.mean, out_t: v.out_of_sample.t, out_n: v.out_of_sample.n,
    out_win: v.out_of_sample.win, trades_live: live.has(k), source: "2 years, theme names" })));
  renderTable(document.getElementById("sw-bt"), bt, [
    { key: "key", label: "Rule", fmt: (v, r) => el("span", { title: r.rule, text: ruleName(v) }) },
    { key: "source", label: "Tested on", fmt: (v) => el("span", { class: "note", text: v }) },
    { key: "hold_days", label: "Hold", num: true, fmt: (v) => `${v}d` },
    { key: "in_mean", label: "In sample", num: true, fmt: (v) => sp(v, 2) },
    { key: "out_n", label: "Out: trades", num: true },
    { key: "out_mean", label: "Out: mean", num: true, fmt: (v) => el("span", { class: `tk-vs ${tn(v)}`, text: sp(v, 2) }) },
    { key: "out_t", label: "t", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(1)) },
    { key: "out_win", label: "Winners", num: true, fmt: (v) => (v == null ? "–" : `${Math.round(v * 100)}%`) },
    { key: "trades_live", label: "Trades live", fmt: (v, r) => el("span", { class: `pill ${v ? "on" : "muted"}`, text: v ? "yes" : r.control ? "control" : "no" }) },
  ], { sortKey: "out_t", dir: -1 });
  document.getElementById("sw-note").textContent =
    `Each rule was judged on two years of the theme's daily prices and headlines: decided at the close, bought at the next open, ` +
    `out at its stop, target or time limit (stop first when a day touches both). Rules were judged before ${W.backtest_split} and tested ` +
    `unchanged after it, net of ${(W.backtest_cost * 1e4).toFixed(0)}bp a side. A rule trades only if its out-of-sample average trade ` +
    "is positive with t ≥ 2 and it also made money in sample. The rules that trade now come from the fourteen-year small-cap test " +
    "below, because two years of seventy-three names could not tell any rule from luck once thousands were tried. The hedged pair " +
    "needs a short sale, which a TFSA cannot make: it is shown for comparison only.";
}

/* ---------- the labs (venture/lab.py, lab_pit.py, market_lab.py) ---------- */

let VL = null;

function lab() {
  const panel = document.getElementById("lab-panel");
  if (!VL) { if (panel) panel.hidden = true; return; }
  const T = VL.theme, P = VL.pit, M = VL.market;
  document.getElementById("lab-meta").textContent = `re-run every Monday · ${fmtDay(VL.as_of)}`;
  renderStats("lab-strip", [
    T ? { label: "Theme names, two years", value: T.tested.toLocaleString(), delta: `rules tried; ${T.passed_in_sample} worked in sample, ${T.passed_out_of_sample} after` } : null,
    P ? { label: "Small caps, 2013 to now", value: P.tested.toLocaleString(), delta: `rules on ${P.names.toLocaleString()} names; ${P.passed_in_sample} worked to 2020` } : null,
    { label: "Adopted", value: String(Object.keys(VL.adopted || {}).length), delta: Object.keys(VL.adopted || {}).map(ruleName).join(", ") || "none" },
    M ? { label: "SPY trend switch, 2018 on", value: sp(M.chosen_result.out_of_sample.cagr, 1), delta: `a year, against ${sp(M.buy_and_hold.out_of_sample.cagr, 1)} buy and hold` } : null,
  ]);
  const body = document.getElementById("lab-body"); body.innerHTML = "";
  const para = (t) => body.appendChild(el("p", { text: t }));
  if (T) para(`Every permutation we could build on the thesis names — strong and weak days, multi-day extremes, breakouts, gaps, earnings surprises, insider purchases, news bursts, laggards in a pillar, correlated pairs — each crossed with news, trend, market and volatility filters, holds of one to seven days and four exits: ${T.tested.toLocaleString()} rules. ${T.passed_in_sample} made money from late 2024 to December 2025; none survived the false-discovery correction after it. The best twenty-five in sample averaged ${sp(T.decay.top25_in_mean, 2)} a trade in sample and ${sp(T.decay.top25_out_mean, 2)} after: positive, but not distinguishable from luck on seventy-three names and two years.`);
  if (P) para(`So the price-and-volume families were re-run on fourteen years of point-in-time small caps, failures included (${P.names.toLocaleString()} names). One family held in both halves: buying a sharp three-to-five-day fall (short-term reversal, documented since Jegadeesh 1990). Momentum, breakouts and the trend filters did not. The reversal variant chosen on 2013-2020 earned the swing sleeve its rule; it is re-checked weekly and stops trading if it stops replicating.`);
  if (M) para(`At the market level, twenty years of SPY: a trend switch (${trendName(M.chosen)}) cut the worst drawdown from ${sp(M.buy_and_hold.in_sample.max_dd, 0)} to ${sp(M.chosen_result.in_sample.max_dd, 0)} before 2018 but earned less after it (${sp(M.chosen_result.out_of_sample.cagr, 1)} a year against ${sp(M.buy_and_hold.out_of_sample.cagr, 1)}): it protects, it does not maximise. The FOMC-day drift (t ${M.calendar.fomc_decision_day.in_sample.t_vs_others} before 2018) vanished after; the turn of the month and the weekday showed nothing; SPY earned more overnight than during the day. Idle swing cash therefore sits in SPY.`);
  const rows = (P?.top || []).map((r) => ({ rule: r.rule, in_mean: r.in_sample.mean, in_t: r.in_sample.t, out_mean: r.out_of_sample.mean, out_t: r.out_of_sample.t, n: r.out_of_sample.n }));
  renderTable(document.getElementById("lab-table"), rows, [
    { key: "rule", label: "Best rules, 2013-2020 (small caps)", fmt: (v) => el("span", { title: v, text: labRule(v) }) },
    { key: "in_mean", label: "To 2020", num: true, fmt: (v) => sp(v, 2) },
    { key: "in_t", label: "t", num: true },
    { key: "out_mean", label: "2021 on", num: true, fmt: (v) => el("span", { class: `tk-vs ${tn(v)}`, text: sp(v, 2) }) },
    { key: "out_t", label: "t", num: true },
    { key: "n", label: "Trades", num: true, fmt: (v) => (v || 0).toLocaleString() },
  ], { sortKey: "in_t", dir: -1 });
  document.getElementById("lab-note").textContent =
    "Protocol: each rule judged only on the earlier period; survivors tested once on the later one; returns averaged by week before the " +
    "t-statistic; the Benjamini-Hochberg procedure across everything tried; 10bp a side. Small-cap trades buy at the next close and sell at a " +
    "later close. Past replication is evidence, not a promise: reversal trades buy names that are falling for a reason as often as by accident.";
}

/* ---------- the managed book (venture/book.py) ---------- */

let VB = null;
const usd = (x, dp = 0) => (x == null ? "–" : `${x < 0 ? "−" : ""}US$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const sp = (x, dp = 1) => (x == null ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(dp)}%`);
const tn = (x) => (x == null || Math.abs(x) < 1e-9 ? "" : x > 0 ? "up" : "down");

function vbook() {
  const panel = document.getElementById("vb-panel");
  if (!VB) { if (panel) panel.hidden = true; return; }
  const C = VB.comparison, last = C[C.length - 1] || {};
  const r = (k) => (last[k] == null ? null : last[k] / 100 - 1);
  document.getElementById("vb-meta").textContent = `from ${fmtDay(VB.inception)} · each line from 100`;
  renderStats("vb-strip", [
    { label: "Venture book", value: sp(r("venture"), 2), tone: tn(r("venture")), delta: `${usd(VB.nav)} of ${usd(VB.capital)}` },
    { label: "Your Questrade portfolio", value: sp(r("questrade"), 2), tone: tn(r("questrade")), delta: "time-weighted, CAD" },
    { label: "S&P 500", value: sp(r("spx"), 2), tone: tn(r("spx")), delta: "price index" },
    { label: "Drift", value: VB.drift == null ? "–" : `${(VB.drift * 100).toFixed(1)}%`, delta: `from the ${fmtDay(VB.last_rebalance)} target` },
    { label: "Next rebalance", value: VB.next_rebalance ? fmtDay(VB.next_rebalance) : "–", delta: `${VB.n_trades} trades so far` },
  ]);
  const accent = tok("--accent"), ink = tok("--ink-2"), muted = tok("--muted");
  const cfg = lineConfig({ labels: C.map((p) => p.date), yFmt: (v) => `${v >= 100 ? "+" : ""}${(v - 100).toFixed(Math.abs(v - 100) < 10 && v % 1 ? 1 : 0)}%`, series: [
    { label: "Venture book", data: C.map((p) => p.venture), color: accent, width: 2.25 },
    { label: "Your Questrade portfolio", data: C.map((p) => p.questrade), color: ink, width: 1.5 },
    { label: "S&P 500", data: C.map((p) => p.spx), color: muted, width: 1.25, dash: [4, 3] },
  ] });
  cfg.options.plugins.legend = { display: false };
  cfg.options.plugins.tooltip = { callbacks: { label: (c) => ` ${c.dataset.label}: ${sp(c.parsed.y / 100 - 1, 2)}` } };
  cfg.data.datasets.forEach((d) => { d.spanGaps = true; if (C.length < 12) { d.pointRadius = 3; } });
  const box = document.getElementById("vb-chart").closest(".chart");
  if (C.length < 2) {
    // One session of record: a chart of a single point is an empty grid.
    box.hidden = true;
    document.getElementById("vb-legend").hidden = true;
  } else {
    box.hidden = false;
    document.getElementById("vb-legend").hidden = false;
    draw("vb-chart", cfg);
  }
  const lg = document.getElementById("vb-legend"); lg.innerHTML = "";
  [["Venture book", accent], ["Your Questrade portfolio", ink], ["S&P 500", muted]].forEach(([t, c]) =>
    lg.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-line", style: `border-top-color:${c}` }), el("span", { text: t })])));
  document.getElementById("vb-note").textContent = (C.length < 2
    ? `The record starts on ${fmtDay(VB.inception)}; the chart draws itself from the next session, when there is a second point to join. `
    : "") +
    `The book started at US$100,000 on ${fmtDay(VB.inception)}, the day its mandate was set; every line starts at 100 then. ` +
    "The Questrade line is the time-weighted return of both TFSAs in Canadian dollars; the venture book is in US dollars " +
    "and pays no fees or taxes. Different currencies and costs: read the shapes, not the decimals.";

  renderTable(document.getElementById("vb-pos"), VB.positions, [
    { key: "symbol", label: "Stock", fmt: (v, r2) => el("a", { class: "sym", href: `#${v}`, text: v, title: r2.name || "" }) },
    { key: "weight", label: "Weight", num: true, fmt: (v, r2) => el("span", { title: `target ${(r2.target * 100).toFixed(1)}%`, text: `${(v * 100).toFixed(1)}%` }) },
    { key: "shares", label: "Shares", num: true, fmt: (v) => v.toFixed(v < 10 ? 2 : 0) },
    { key: "entry", label: "Entry", num: true, fmt: (v, r2) => el("span", { title: r2.entry_date, text: usd(v, 2) }) },
    { key: "last", label: "Last", num: true, fmt: (v) => usd(v, 2) },
    { key: "gain", label: "Gain", num: true, fmt: (v) => el("span", { class: `tk-vs ${tn(v)}`, text: sp(v) }) },
    { key: "pillar", label: "Pillar", fmt: (v) => el("span", { class: "note", text: v || "–" }) },
    { key: "why", label: "Why it is held", fmt: (v) => el("span", { class: "note",
        text: v ? [`theme score ${v.adj}`, ...(v.flags || []).map(flagLabel)].join(" · ") : "inception holding" }) },
  ], { sortKey: "weight", dir: -1 });
  document.getElementById("vb-pos-meta").textContent = `${VB.positions.length} names · ${(VB.cash_weight * 100).toFixed(0)}% cash`;
  const byP = {};
  VB.positions.forEach((p) => { byP[p.pillar || "Other"] = (byP[p.pillar || "Other"] || 0) + p.weight; });
  const pil = Object.entries(byP).sort((a, b) => b[1] - a[1]), cols = breakdownColors(pil.length);
  // The rest of the book: the swing sleeve's idle cash parked in SPY, then cash.
  const spyW = VB.nav ? ((VB.swing || {}).parked_in_spy || 0) / VB.nav : 0;
  if (spyW > 0.001) { pil.push(["Swing sleeve, parked in SPY", spyW]); cols.push(tok("--muted")); }
  if ((VB.cash_weight || 0) > 0.001) { pil.push(["Cash", VB.cash_weight]); cols.push(tok("--border-2")); }
  const bar = document.getElementById("vb-pillars");
  bar.replaceChildren(...pil.map(([k, w], i) => el("i", { style: `flex:${w};background:${cols[i]}`, title: `${k} ${(w * 100).toFixed(0)}%` })));
  bar.setAttribute("aria-label", pil.map(([k, w]) => `${k} ${(w * 100).toFixed(0)}%`).join(", "));
  const pl = document.getElementById("vb-pillar-legend"); pl.innerHTML = "";
  pil.forEach(([k, w], i) => pl.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-rect", style: `background:${cols[i]}` }),
    el("span", { text: `${k} ${(w * 100).toFixed(0)}%` })])));
  const P = VB.previous;
  document.getElementById("vb-previous").textContent = P
    ? `${P.label}, ${fmtDay(P.inception)} to ${fmtDay(P.closed)}: closed at ${sp(P.ret, 2)} over ${P.trades} trades when the mandate changed to physical AI and quantum.`
    : "";
  const heads = Object.entries(VB.news || {}).flatMap(([s, v]) => v.slice(0, 1).map((h) => `${s}: ${h.title}`)).slice(0, 4);
  document.getElementById("vb-pos-note").textContent = heads.length ? `This week's news on holdings: ${heads.join(" · ")}` : "";

  renderTable(document.getElementById("vb-trades"), VB.trades.slice(0, 25), [
    { key: "date", label: "Date", fmt: (v) => el("span", { class: "tk-date", text: v }) },
    { key: "side", label: "", fmt: (v) => el("span", { class: `pill ${v === "buy" ? "up" : "down"}`, text: v }) },
    { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "value", label: "Value", num: true, fmt: (v) => usd(v) },
    { key: "price", label: "Price", num: true, fmt: (v) => usd(v, 2) },
    { key: "reason", label: "Why", cls: () => "note wrap", fmt: (v) => (v || "").replace(/ \(\)$/, "").replace(/\(([A-Z_, ]+)\)$/, (_, f) => `· ${f.split(/,\s*/).map(flagLabel).join(", ")}`) },
  ], { sortKey: "date", dir: -1 });
  document.getElementById("vb-tr-meta").textContent = `${VB.n_trades} trades since ${fmtDay(VB.inception)}`;
  const R = VB.rules;
  document.getElementById("vb-rules").textContent =
    `Rules: every ${R.rebalance_days} days, the top ${R.n} names by evidence score (holdings kept while in the top ${R.keep_rank}), ` +
    `+0.5 for a positive catalyst headline, none with a negative one; weights by score over volatility, ${R.w_min * 100}% to ` +
    `${R.w_max * 100}%, no sector over ${R.sector_max * 100}%. Every day: out at ${R.stop * 100}% below entry, ${R.trail * 100}% below ` +
    `the high once ${R.trail_arm * 100}% up, on a negative news event, or when the evidence score falls to zero; ` +
    `${R.stress_cash * 100}% cash when the stress probability passes ${R.stress_p * 100}%. Momentum is negative in this ` +
    "universe and no signal here clears |t| ≥ 3: this is a record of the rules, not a forecast.";
}

(async function init() {
  renderShell();
  VB = await loadJSON("data/venture_book.json").catch(() => null);
  VT = await loadJSON("data/venture_theme.json").catch(() => null);
  VL = await loadJSON("data/venture_lab.json").catch(() => null);
  const content = document.getElementById("content");
  try { DATA = await loadJSON("data/venture.json"); }
  catch (err) { showError(content, err); return; }
  setAsOf(DATA.as_of);
  document.getElementById("disclosure").textContent = DATA.disclosure;
  const unav = document.getElementById("unavailable");
  unav.replaceChildren(...Object.entries(DATA.unavailable || {}).map(([k, v]) => el("li", { text: `${k}: ${v}` })));
  const ff = document.getElementById("flagfilter");
  ff.replaceChildren(el("button", { class: "active", "data-flag": "", text: "All" }),
    ...DATA.evidence.map((e) => el("button", { "data-flag": e.key, text: e.key })));
  registerCommands(DATA.rows.map((r) => ({ key: r.symbol, hint: r.profile_label || "", act: () => detail(r) })));
  thesis(); vbook(); swingPanel(); lab(); universe(); headline(); macro(); evidence(); baseRates(); paint(); portfolio(); themes(); wire();
  pitches();
  const hash = decodeURIComponent(location.hash.slice(1));
  const hit = hash && DATA.rows.find((r) => r.symbol === hash);
  if (hit) detail(hit);
})();
