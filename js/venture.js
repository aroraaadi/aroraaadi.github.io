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
    { key: "note", label: "What it means here" },
    { key: "sources_txt", label: "Sources" },
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
    { key: "flags_n", label: "Flags", fmt: (_, r) => el("span", { class: "flags" }, r.flags.map(flagPill)) },
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
    ...idx.pitches.map((p) => el("div", { class: "alloc-row" }, [
      el("a", { class: "sym", href: base() + p.path, target: "_blank", rel: "noopener", text: p.symbol }),
      el("span", { class: "muted", text: p.call }),
      el("span", { class: "spacer" }),
      el("a", { class: "note", href: base() + p.path, target: "_blank", rel: "noopener", text: "PDF ↗" }),
    ])),
    idx.without_thesis.length
      ? el("p", { class: "note", text: `In the portfolio without a written thesis, so no PDF: ${idx.without_thesis.join(", ")}.` })
      : null,
  );
}

function themes() {
  const host = document.getElementById("themes");
  host.replaceChildren(...Object.entries(DATA.themes).filter(([, t]) => t.names.length).map(([k, t]) =>
    el("div", { class: "alloc-row" }, [
      el("span", { class: "clabel", text: t.label }),
      el("span", { class: "flags" }, t.names.map((s) => el("span", { class: "chip", text: s }))),
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
  const P = T.projections;
  renderTable(document.getElementById("vx-proj"), P.rows.map((r) => ({ a: r[0], b: r[1], c: r[2] })), [
    { key: "a", label: "" }, { key: "b", label: P.head[1] }, { key: "c", label: P.head[2] },
  ]);
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
    { key: "flags_evidence", label: "Evidence", fmt: (v) => el("span", { class: "note", text: (v || []).join(", ") || "–" }) },
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
  const cfg = lineConfig({ labels: C.map((p) => p.date), yFmt: (v) => `${v >= 100 ? "+" : ""}${(v - 100).toFixed(0)}%`, series: [
    { label: "Venture book", data: C.map((p) => p.venture), color: accent, width: 2.25 },
    { label: "Your Questrade portfolio", data: C.map((p) => p.questrade), color: ink, width: 1.5 },
    { label: "S&P 500", data: C.map((p) => p.spx), color: muted, width: 1.25, dash: [4, 3] },
  ] });
  cfg.options.plugins.legend = { display: false };
  cfg.options.plugins.tooltip = { callbacks: { label: (c) => ` ${c.dataset.label}: ${sp(c.parsed.y / 100 - 1, 2)}` } };
  cfg.data.datasets.forEach((d) => { d.spanGaps = true; });
  draw("vb-chart", cfg);
  const lg = document.getElementById("vb-legend"); lg.innerHTML = "";
  [["Venture book", accent], ["Your Questrade portfolio", ink], ["S&P 500", muted]].forEach(([t, c]) =>
    lg.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-line", style: `border-top-color:${c}` }), el("span", { text: t })])));
  document.getElementById("vb-note").textContent =
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
    { key: "why", label: "Why it is held", fmt: (v) => el("span", { class: "note", text: v ? `score ${v.adj} · ${(v.flags || []).join(", ")}` : "inception holding" }) },
  ], { sortKey: "weight", dir: -1 });
  document.getElementById("vb-pos-meta").textContent = `${VB.positions.length} names · ${(VB.cash_weight * 100).toFixed(0)}% cash`;
  const byP = {};
  VB.positions.forEach((p) => { byP[p.pillar || "Other"] = (byP[p.pillar || "Other"] || 0) + p.weight; });
  const pil = Object.entries(byP).sort((a, b) => b[1] - a[1]), cols = breakdownColors(pil.length);
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
    { key: "reason", label: "Why", cls: () => "note" },
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
  thesis(); vbook(); universe(); headline(); macro(); evidence(); baseRates(); paint(); portfolio(); themes(); wire();
  pitches();
  const hash = decodeURIComponent(location.hash.slice(1));
  const hit = hash && DATA.rows.find((r) => r.symbol === hash);
  if (hit) detail(hit);
})();
