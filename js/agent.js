/* The Macro agent tab: the daily macro desk. Today's scenario, forward scenarios and the critics, the watchlist,
   the news, the paper book and its Alpaca mirror, the research behind it, and every run. */
import { loadJSON, showError, fmtPct, fmtDate, fmtSigned, money, tone, el, renderStats, renderTable, tok, alpha, slotColor } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { applyChartDefaults, draw, lineConfig, hbarConfig, doughnutConfig } from "./charts.js";
import { ticker, sparkline } from "./terminal.js";
import { squarify, boxColor } from "./treemap.js";

const $ = (id) => document.getElementById(id);
const usd = (x) => money(x, "USD", 0);
const day = (iso) => (iso ? fmtDate(String(iso).slice(0, 10)) : "–");
const VERDICT_TONE = { "EVIDENCE OF SKILL": "up", UNDERPERFORMING: "down", "NO EVIDENCE OF SKILL": "down", UNPROVEN: "", "NOT STARTED": "" };
const STATUS_TONE = { ok: "up", refused: "down", failed: "down", degraded: "warn" };
const GRADE_TONE = { established: "established", replicated: "up", suggestive: "warn", failed: "down", untested: "muted" };
const DIR = { up: 1, down: -1, flat: 0 };
const pill = (text, t) => el("span", { class: `pill ${t || "muted"}`, text });
let A = null, S = null, P = null, M = null, LV = null;
let period = "r1m";

/* ------------------------------------------------------------------ tabs */
function tabs() {
  const want = (() => { try { return localStorage.getItem("desk-tab"); } catch { return null; } })() || "today";
  const show = (k) => {
    document.querySelectorAll("main section[data-tab]").forEach((s) => { s.hidden = s.dataset.tab !== k; });
    document.querySelectorAll("#dk-tabs button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === k);
      b.setAttribute("aria-selected", String(b.dataset.tab === k));
    });
    try { localStorage.setItem("desk-tab", k); } catch { /* private mode */ }
  };
  document.querySelectorAll("#dk-tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  show(document.querySelector(`#dk-tabs button[data-tab="${want}"]`) ? want : "today");
}

/* ------------------------------------------------------------------ strip */
function strip() {
  const c = A.scorecard || {}, tr = c.total_return || {}, ex = c.excess || {}, r = c.runs || {};
  const now = S?.macro?.now || {};
  const vol = Object.fromEntries((S?.vol || []).map((v) => [v.symbol, v]));
  renderStats("ag-strip", [
    { label: "Quadrant", value: now.quadrant || "–", delta: now.stress ? "stress ON" : "no stress", deltaTone: now.stress ? "down" : "" },
    { label: "VIX", value: vol.VIX ? String(vol.VIX.level) : "–", delta: vol.VIX ? `${fmtPct(vol.VIX.pct_since_2003, 0)} pctile` : "" },
    { label: "MOVE", value: vol.MOVE ? String(vol.MOVE.level) : "–", delta: vol.MOVE ? `${fmtPct(vol.MOVE.pct_since_2003, 0)} pctile` : "" },
    { label: "Verdict", value: c.verdict || "–", tone: VERDICT_TONE[c.verdict] },
    { label: "Book", value: fmtSigned(tr.book), tone: tone(tr.book), delta: A.inception ? `since ${day(A.inception)}` : "not started" },
    { label: "vs 60/40", value: fmtSigned(ex.sixty_forty), tone: tone(ex.sixty_forty) },
    { label: "vs the rule", value: fmtSigned(ex.rule), tone: tone(ex.rule) },
    { label: "Net / gross", value: c.exposure ? `${fmtPct(c.exposure.net, 0)} / ${fmtPct(c.exposure.gross, 0)}` : "–" },
    { label: "Runs", value: `${(r.daily || 0) - (r.failed || 0)} ok`, tone: r.failed ? "down" : "",
      delta: `${r.failed || 0} failed · API $${(r.list_cost_usd || 0).toFixed(2)}` },
  ]);
}

/* ------------------------------------------------------------------ today */
function today() {
  const L = A.latest;
  if (!L) {
    $("dk-headline").textContent = "No desk run yet: the first runs on a weekday evening after the close.";
    return;
  }
  $("dk-t-meta").textContent = `${day(L.date)} · data to ${day(L.as_of)} · ${L.traded ? `decision ${L.decision}` : "no trade"}`;
  $("dk-headline").replaceChildren(el("strong", { text: L.title || "" }), " ", L.summary || "");
  $("dk-overview").textContent = L.overview || "";
  const probs = Object.entries(L.regime?.probabilities || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmtPct(v, 0)}`).join(", ");
  $("dk-regime").textContent = `Regime call: ${L.regime?.call || "–"} (${L.regime?.confidence || "?"} confidence; ${probs}). The macro layer's quadrant: ${L.quadrant || "–"}.`;
  scenarioMap(L);
  tilts(L);
  const cur = L.current || {}, tgt = L.target || {};
  const attr = (A.decisions || []).find((d) => d.id === L.decision)?.attribution || {};
  const rows = [...new Set([...Object.keys(cur), ...Object.keys(tgt)])].map((s) => ({
    symbol: s, current: cur[s] ?? 0, target: tgt[s] ?? 0, change: (tgt[s] ?? 0) - (cur[s] ?? 0),
    scenario: attr[s]?.scenario, type: attr[s]?.type?.replace("_", " ") }));
  $("dk-tg-meta").textContent = L.traded ? "fills at the next close" : "inside the no-trade band: nothing sent";
  $("dk-tg-note").textContent = (L.notes || []).join(" · ") || "Sized by code from the surviving ideas: conviction × posterior × inverse vol, to an 8% annual vol.";
  renderTable($("dk-target"), rows, [
    { key: "symbol", label: "Line" },
    { key: "current", label: "Now", num: true, fmt: (v) => fmtPct(v) },
    { key: "target", label: "Target", num: true, fmt: (v) => fmtPct(v) },
    { key: "change", label: "Change", num: true, fmt: (v) => el("span", { class: tone(v), text: fmtSigned(v) }) },
    { key: "scenario", label: "Scenario" },
    { key: "type", label: "Trade type" },
  ], { sortKey: "target", empty: "All cash." });
}

function scenarioMap(L) {
  const now = S?.macro?.now || {};
  const clamp = (x) => Math.max(-2.4, Math.min(2.4, x ?? 0));
  const here = { x: clamp(now.growth), y: clamp(now.inflation) };
  const scen = L.scenarios || [];
  const color = (i, s) => (s.status === "kept" ? slotColor(i) : tok("--muted"));
  const datasets = [];
  scen.forEach((s, i) => {
    const to = { x: clamp(here.x + s.growth * 0.6), y: clamp(here.y + s.inflation * 0.6) };
    datasets.push({ type: "line", data: [here, to], borderColor: alpha(color(i, s), 0.6), borderWidth: 1.5, borderDash: s.status === "kept" ? [] : [3, 3], pointRadius: 0, label: "" });
    datasets.push({ type: "bubble", label: `${s.id} ${s.name}`, data: [{ ...to, r: 5 + 28 * (s.posterior || 0) }],
                    backgroundColor: alpha(color(i, s), 0.45), borderColor: color(i, s), borderWidth: 1.5 });
  });
  datasets.push({ type: "bubble", label: "Now", data: [{ ...here, r: 6 }], backgroundColor: tok("--ink"), borderColor: tok("--ink") });
  const quads = { id: "quads", afterDraw(c) {
    const { ctx, chartArea: a } = c;
    ctx.save(); ctx.fillStyle = tok("--muted"); ctx.font = "11px sans-serif";
    ctx.textAlign = "left"; ctx.fillText("stagflation", a.left + 6, a.top + 14); ctx.fillText("slowdown", a.left + 6, a.bottom - 6);
    ctx.textAlign = "right"; ctx.fillText("reflation", a.right - 6, a.top + 14); ctx.fillText("expansion", a.right - 6, a.bottom - 6);
    ctx.restore(); } };
  const axis = (t) => ({ min: -3, max: 3, title: { display: true, text: t }, grid: { color: (c) => (c.tick.value === 0 ? tok("--baseline") : tok("--grid")) } });
  draw("dk-map", { type: "bubble", data: { datasets }, plugins: [quads],
    options: { responsive: true, maintainAspectRatio: false, scales: { x: axis("growth →"), y: axis("inflation →") },
      plugins: { tooltip: { filter: (it) => !!it.dataset.label, callbacks: { label: (c) => {
        const s = scen.find((x) => c.dataset.label.startsWith(x.id + " "));
        return s ? ` ${c.dataset.label}: prior ${fmtPct(s.probability, 0)} → ${fmtPct(s.posterior, 0)} (${s.status})` : " Now";
      } } } } } });
  $("dk-map-note").textContent = "The dot is today's macro state: growth and inflation z-scores from market prices. Each bubble is a scenario placed in the direction it implies; its size is the posterior after the critics, and a grey dashed one was rejected.";
}

function tilts(L) {
  const groups = S?.groups || {};
  const kept = (L.scenarios || []).filter((s) => s.status === "kept");
  const keys = Object.keys(groups).filter((g) => g !== "vol");
  const vals = keys.map((g) => kept.reduce((a, s) => a + (s.posterior || 0) * (DIR[s.implies?.[g]] ?? 0), 0));
  draw("dk-tilts", hbarConfig({ labels: keys.map((g) => groups[g]), values: vals,
    colors: vals.map((v) => (v >= 0 ? tok("--up") : tok("--down"))), fmt: (v) => Number(v).toFixed(2),
    valueLabels: vals.map((v) => (v > 0 ? "+" : "") + v.toFixed(2)) }));
}

/* ------------------------------------------------------------------ scenarios */
function scenarios() {
  const L = A.latest;
  if (!L) return;
  const host = $("dk-scen");
  host.replaceChildren(...(L.scenarios || []).map((s) => {
    const bar = (label, v, cls) => el("div", { class: "prob-row" }, [el("span", { text: label }),
      el("span", { class: "meter" }, [el("i", { class: cls, style: `width:${Math.round((v || 0) * 100)}%` })]), el("span", { class: "num", text: fmtPct(v, 0) })]);
    return el("div", { class: `scen-card ${s.status === "kept" ? "" : "rejected"}` }, [
      el("h3", { text: `${s.id} · ${s.name}` }),
      el("p", {}, [pill(s.status, s.status === "kept" ? "on" : "down"), ` ${s.horizon_weeks || "?"} weeks · analogue: ${s.analogue || "–"}`]),
      bar("prior", s.probability, "prior"), bar("posterior", s.posterior, ""),
      el("p", { text: s.narrative || "" }),
      s.chain?.length ? el("ol", {}, s.chain.map((c) => el("li", { text: c }))) : null,
      s.indicators?.length ? el("ul", {}, s.indicators.map((i) => el("li", { text: `${i.what}: watch ${i.threshold} (now ${i.now})` }))) : null,
      el("p", {}, [el("strong", { text: "Invalidation: " }), s.invalidation || "–"]),
    ]);
  }));
  const crit = (L.critics || []);
  $("dk-cr-meta").textContent = `${crit.filter((c) => !c.error).length} of ${crit.length} critics answered · $${crit.reduce((a, c) => a + (c.cost_usd || 0), 0).toFixed(2)}`;
  $("dk-critics").replaceChildren(...crit.map((c) => el("li", { text: `${c.role}: ${c.error ? `failed (${c.error})` : c.overall || ""}` })));
  const names = crit.map((c) => c.critic);
  const cell = (it, k) => {
    const x = (it.critics || []).find((c) => c.critic === k);
    if (!x) return "–";
    return el("span", { class: `crit-cell ${x.verdict === "reject" ? "down" : x.verdict === "keep" ? "up" : ""}`,
                        title: (x.objections || []).join("\n") || "no objection", text: `${x.plausibility.toFixed(2)} ${x.verdict}` });
  };
  const rows = [...(L.scenarios || []).map((s) => ({ ...s, kind: "scenario", label: `${s.id} ${s.name}`, out: s.posterior })),
                ...(L.ideas || []).map((t) => ({ ...t, kind: "trade", label: `${t.id} ${t.side} ${t.expression}`, out: t.score }))];
  renderTable($("dk-grid"), rows, [
    { key: "label", label: "Item" },
    ...names.map((k) => ({ key: k, label: k.replace("_", " "), fmt: (_, r) => cell(r, k) })),
    { key: "status", label: "Outcome", fmt: (v) => pill(v, v === "kept" ? "on" : "down") },
    { key: "out", label: "Posterior / score", num: true, fmt: (v) => Number(v || 0).toFixed(3) },
  ]);
  renderTable($("dk-ideas"), L.ideas || [], [
    { key: "id", label: "#" },
    { key: "expression", label: "Expression" },
    { key: "side", label: "Side", fmt: (v) => pill(v, v === "long" ? "up" : "down") },
    { key: "type", label: "Type", fmt: (v) => (v || "").replace("_", " ") },
    { key: "scenario", label: "Scenario" },
    { key: "conviction", label: "Conv.", num: true },
    { key: "thesis", label: "Thesis", cls: () => "note" },
    { key: "invalidation", label: "Invalidation", cls: () => "note" },
    { key: "status", label: "After critics", fmt: (v, r) => (v === "kept" ? pill("kept", "on") : el("span", { class: "note", text: `dropped: ${r.why_dropped}` })) },
  ], { empty: "No trade ideas today." });
  history();
}

function history() {
  const H = A.scenario_history || [];
  if (H.length < 2) { $("dk-hist-note").textContent = "The line starts once the desk has run on two days."; return; }
  const ids = [...new Set(H.flatMap((h) => h.scenarios.map((s) => s.id)))];
  const name = Object.fromEntries(H.flatMap((h) => h.scenarios.map((s) => [s.id, s.name])));
  draw("dk-hist", lineConfig({ labels: H.map((h) => h.date), yFmt: (v) => fmtPct(v, 0),
    series: ids.map((id, i) => ({ label: `${id} ${name[id]}`, color: slotColor(i), width: 1.6,
      data: H.map((h) => h.scenarios.find((s) => s.id === id)?.posterior ?? null) })) }));
  $("dk-hist-note").textContent = "Scenario ids carry over while the desk keeps a scenario; a new id is a new story.";
}

/* ------------------------------------------------------------------ cross-asset */
function heat() {
  if (!S) return;
  const vals = S.lines.map((x) => Math.abs(x[period] ?? 0));
  const scale = Math.max(0.02, vals.sort((a, b) => a - b)[Math.floor(vals.length * 0.9)] || 0.05);
  const groups = Object.entries(S.groups).filter(([g]) => g !== "vol");
  $("dk-heat").replaceChildren(...groups.map(([g, label]) => el("div", {}, [el("h3", { text: label }),
    el("div", { class: "heat-row" }, S.lines.filter((x) => x.group === g).map((x) => {
      const v = x[period];
      const bg = v == null ? "transparent" : alpha(tok(v >= 0 ? "--up" : "--down"), Math.min(0.85, 0.12 + Math.abs(v) / scale * 0.6));
      return el("div", { class: "heat-tile", style: `background:${bg}`,
        title: `${x.symbol}: ${x.desc}\n1d ${fmtSigned(x.r1d)} · 1w ${fmtSigned(x.r1w)} · 1m ${fmtSigned(x.r1m)} · 3m ${fmtSigned(x.r3m)} · 12m ${fmtSigned(x.r12m)}\nvol ${fmtPct(x.vol3m, 0)} · from 52w high ${fmtPct(x.dd)} · 3m rank in group ${x.rank_in_group || "–"}` }, [
        el("b", { text: x.symbol }), el("span", { class: "num", text: fmtSigned(v) }), " ",
        el("span", { class: x.trend ? "" : "off", text: x.trend == null ? "" : x.trend ? "▲ trend" : "▽ no trend" })]);
    }))])));
  $("dk-heat-note").textContent = `As of ${day(S.as_of)}. Total returns; hover a tile for the owner's note on what the line tells us and every window.`;
}

function periodButtons() {
  document.querySelectorAll("#dk-period button").forEach((b) => b.addEventListener("click", () => {
    period = b.dataset.k;
    document.querySelectorAll("#dk-period button").forEach((x) => x.classList.toggle("active", x === b));
    heat();
  }));
}

function cross() {
  if (!S) return;
  heat();
  renderStats("dk-vol", (S.vol || []).map((v) => ({ label: v.symbol, value: String(v.level),
    delta: `${fmtPct(v.pct_since_2003, 0)} percentile since 2003${v.ch1m == null ? "" : ` · 1m ${v.ch1m > 0 ? "+" : ""}${v.ch1m}`}${v.term_inverted ? " · curve INVERTED" : ""}`,
    deltaTone: v.term_inverted ? "down" : "" })));
  const b = S.breadth || [];
  draw("dk-breadth", hbarConfig({ labels: b.map((x) => x.label), values: b.map((x) => Math.round((x.up_share || 0) * 100)),
    colors: b.map((x) => ((x.up_share || 0) >= 0.5 ? tok("--up") : tok("--down"))) }));
  renderTable($("dk-pairs"), S.pairs || [], [
    { key: "pair", label: "Pair" },
    { key: "spark", label: "1 year", fmt: (v) => spark(v || []) },
    { key: "r1m", label: "1m", num: true, fmt: (v) => el("span", { class: tone(v), text: fmtSigned(v) }) },
    { key: "r3m", label: "3m", num: true, fmt: (v) => el("span", { class: tone(v), text: fmtSigned(v) }) },
    { key: "range_1y", label: "In 1y range", num: true, fmt: (v) => fmtPct(v, 0) },
    { key: "what", label: "What it says", cls: () => "note" },
  ]);
}

function spark(v) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "90"); svg.setAttribute("height", "22"); svg.setAttribute("aria-hidden", "true");
  const xs = v.filter((x) => x != null);
  if (xs.length > 1) {
    const lo = Math.min(...xs), hi = Math.max(...xs) || 1, span = hi - lo || 1;
    const path = document.createElementNS(ns, "polyline");
    path.setAttribute("points", xs.map((x, i) => `${(i / (xs.length - 1) * 88 + 1).toFixed(1)},${(21 - (x - lo) / span * 20).toFixed(1)}`).join(" "));
    path.setAttribute("fill", "none"); path.setAttribute("stroke", xs[xs.length - 1] >= xs[0] ? tok("--up") : tok("--down")); path.setAttribute("stroke-width", "1.4");
    svg.appendChild(path);
  }
  return svg;
}

/* ------------------------------------------------------------------ news */
async function news() {
  const L = A.latest || {};
  renderTable($("dk-geo"), L.geopolitics || [], [
    { key: "theme", label: "Theme" },
    { key: "read", label: "The desk's read", cls: () => "note" },
    { key: "groups", label: "Groups touched", fmt: (v) => (v || []).map((g) => S?.groups?.[g] || g).join(", ") },
    { key: "source", label: "Source", cls: () => "note" },
  ], { empty: "No geopolitical theme flagged in the latest run." });
  const ev = S?.events?.events || [];
  $("dk-ev-meta").textContent = S?.events ? `${S.events.source || ""} feed, built ${day(S.events.built)}` : "";
  renderTable($("dk-events"), ev, [
    { key: "headline", label: "Event" },
    { key: "topics", label: "Topics", fmt: (v) => (v || []).join(", ") },
    { key: "publishers", label: "Publishers", num: true },
    { key: "hours_ago", label: "Hours ago", num: true },
  ], { empty: "No key events in the feed." });
  try {
    await libs();
    $("ag-report").innerHTML = window.DOMPurify.sanitize(window.marked.parse(L.report_md || ""));
  } catch { $("ag-report").textContent = L.report_md || ""; }
}

function libs() {
  if (window.marked && window.DOMPurify) return Promise.resolve();
  return new Promise((ok, no) => {
    let n = 2;
    for (const src of ["https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
                       "https://cdn.jsdelivr.net/npm/dompurify@3.1.5/dist/purify.min.js"]) {
      const s = document.createElement("script");
      s.src = src; s.onload = () => --n || ok(); s.onerror = no;
      document.head.appendChild(s);
    }
  });
}

/* ------------------------------------------------------------------ book */
function verdict() {
  const c = A.scorecard || {};
  $("ag-verdict").replaceChildren(pill(c.verdict || "–", VERDICT_TONE[c.verdict] || "warn"), " ", c.verdict_note || "");
  $("ag-v-meta").textContent = A.last_marked ? `marked to ${day(A.last_marked)}` : "";
  const flags = c.flags || [];
  $("ag-flags").replaceChildren(...(flags.length ? flags : ["Nothing flagged yet, which with this little history means nothing."])
    .map((f) => el("li", { text: f })));
}

function chart() {
  const n = A.nav || [];
  if (!n.length) {
    $("ag-chart").closest(".chart").hidden = true;
    $("ag-c-note").textContent = "The line starts on the first fill.";
    return;
  }
  $("ag-chart").closest(".chart").hidden = false;
  const lines = [["nav", "Macro desk", "--accent", 2.2], ["sixty_forty", "60/40 (SPY/AGG)", "--ink-2", 1.4],
                 ["rule", "Quadrant rule", "--warn", 1.4], ["acwi", "ACWI", "--muted", 1.2], ["sgov", "Cash (SGOV)", "--grid", 1.2]];
  draw("ag-chart", lineConfig({ labels: n.map((x) => x.date), yFmt: (v) => usd(v),
    series: lines.map(([k, label, color, width]) => ({ label, data: n.map((x) => x[k]), color: tok(color), width })) }));
  $("ag-c-meta").textContent = `${day(n[0].date)} to ${day(n[n.length - 1].date)}`;
  $("ag-c-note").textContent = "Every line starts with the book's capital on its first fill and pays the same costs. 60/40 and the quadrant rule rebalance on the book's fill dates; ACWI and SGOV are bought and held.";
}

function meketa() {
  const m = A.scorecard?.meketa;
  if (!m) { $("dk-mk-note").textContent = "Measured from 20 sessions of the book; the VIX quartiles from 40."; return; }
  renderStats("dk-meketa", [
    { label: "Vol (annual)", value: fmtPct(m.vol_ann) }, { label: "Skew", value: String(m.skew), tone: m.skew > 0 ? "up" : "down" },
    { label: "Excess kurtosis", value: String(m.excess_kurtosis) }, { label: "Corr. to ACWI", value: String(m.corr_acwi), tone: m.corr_acwi > 0.6 ? "down" : "" },
    { label: "Beta to ACWI", value: String(m.beta_acwi) }, { label: "Sessions", value: String(m.sessions) },
  ]);
  $("dk-mk-note").textContent = "Meketa's discretionary macro index (2001-2017) ran 4.8% vol, skew +0.39, a 0.25 correlation to ACWI and a beta of 0.09. A book that looks like ACWI is not doing this job.";
  renderTable($("dk-vixq"), m.by_vix_quartile || [], [
    { key: "quartile", label: "VIX day" },
    { key: "vix_change", label: "VIX change", num: true, fmt: (v) => fmtSigned(v) },
    { key: "book", label: "Book, mean day", num: true, fmt: (v) => el("span", { class: tone(v), text: fmtSigned(v, 2) }) },
    { key: "acwi", label: "ACWI, mean day", num: true, fmt: (v) => el("span", { class: tone(v), text: fmtSigned(v, 2) }) },
  ], { empty: "Needs 40 sessions." });
}

function holdingsTable() {
  const p = A.pending, J = A.journal || {};
  $("ag-pending").textContent = p
    ? `Pending: decision ${p.id} of ${day(p.decided_date)} fills at the first close after it: ${Object.entries(p.target).map(([s, w]) => `${s} ${fmtPct(w, 0)}`).join(", ")}.`
    : "No target waiting to fill.";
  $("ag-h-meta").textContent = A.last_marked ? `at the ${day(A.last_marked)} close` : "";
  const pos = J.positions || [];
  renderStats("dk-pos-strip", [
    { label: "Lines held", value: String(pos.filter((x) => x.symbol !== "SGOV").length) },
    { label: "Unrealised P&L", value: J.unrealized == null ? "–" : smoney(J.unrealized), tone: tone(J.unrealized) },
    { label: "Realised P&L", value: J.realized == null ? "–" : smoney(J.realized), tone: tone(J.realized) },
    { label: "Today's P&L", value: pos.length ? smoney(pos.reduce((a, x) => a + (x.day_pnl || 0), 0)) : "–", tone: tone(pos.reduce((a, x) => a + (x.day_pnl || 0), 0)) },
    { label: "Trading costs", value: J.costs == null ? "–" : usd(J.costs) },
    { label: "Borrow paid", value: J.borrow == null ? "–" : money(J.borrow, "USD", 2) },
  ]);
  renderTable($("ag-hold"), pos, [
    { key: "symbol", label: "Line", fmt: (v, r) => el("span", { title: r.desc || "", text: v }) },
    { key: "spark", label: "6 months", fmt: (_, r) => sparkline(SPARK[r.symbol] || []) },
    { key: "group", label: "Group" },
    { key: "side", label: "Side", fmt: (v) => pill(v, v === "short" ? "down" : "up") },
    { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v) },
    { key: "avg_entry", label: "Avg entry", num: true, fmt: (v) => (v == null ? "–" : Number(v).toFixed(2)) },
    { key: "last", label: "Last", num: true, fmt: (v) => Number(v).toFixed(2) },
    { key: "entry_date", label: "Since", fmt: day },
    { key: "days_held", label: "Sessions", num: true },
    { key: "unrealized", label: "Unrealised", num: true, fmt: pnl },
    { key: "unrealized_pct", label: "%", num: true, fmt: (v) => cellPct(v) },
    { key: "day_pct", label: "Today", num: true, fmt: (v) => cellPct(v) },
    { key: "day_pnl", label: "Day P&L", num: true, fmt: pnl },
    { key: "scenario", label: "Scenario" },
    { key: "type", label: "Type", fmt: (v) => (v || "").replace("_", " ") },
  ], { sortKey: "weight", empty: "Nothing held yet: the first target fills at the first close after its decision." });
}

/* ------------------------------------------------------------------ tracking (desk/journal.py) */
const smoney = (x) => (x == null ? "–" : (x > 0 ? "+" : "") + money(x, "USD", 0));
const pnl = (v) => (v == null ? "–" : el("span", { class: tone(v), text: smoney(v) }));
const cellPct = (v, dp = 2) => (v == null ? "–" : el("span", { class: tone(v), text: fmtSigned(v, dp) }));
const sheetRows = (rows) => rows.map((r, i) => ({ _row: i + 1, ...r }));
const ROWNUM = { key: "_row", label: "", num: true, cls: () => "sheet-rn" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function performance() {
  const J = A.journal || {}, st = J.stats;
  $("dk-pr-meta").textContent = A.inception ? `since ${day(A.inception)}` : "starts on the first fill";
  renderTable($("dk-periods"), J.periods || [], [
    { key: "period", label: "Period" },
    { key: "nav", label: "Desk", num: true, fmt: (v) => cellPct(v) },
    { key: "sixty_forty", label: "60/40", num: true, fmt: (v) => cellPct(v) },
    { key: "acwi", label: "ACWI", num: true, fmt: (v) => cellPct(v) },
    { key: "sgov", label: "Cash", num: true, fmt: (v) => cellPct(v) },
    { key: "rule", label: "Quadrant rule", num: true, fmt: (v) => cellPct(v) },
    { key: "vs", label: "Desk − 60/40", num: true, fmt: (_, r) => cellPct(r.nav != null && r.sixty_forty != null ? r.nav - r.sixty_forty : null) },
  ], { empty: "No marks yet." });
  const n = (v, dp = 2) => (v == null ? "–" : Number(v).toFixed(dp));
  renderStats("dk-stats", st ? [
    { label: "Sessions", value: String(st.sessions) }, { label: "Total", value: fmtSigned(st.total), tone: tone(st.total) },
    { label: "CAGR", value: st.cagr == null ? "–" : fmtPct(st.cagr) }, { label: "Vol", value: fmtPct(st.vol) },
    { label: "Sharpe", value: n(st.sharpe) }, { label: "Sortino", value: n(st.sortino) },
    { label: "Max drawdown", value: fmtPct(st.max_drawdown), tone: "down" }, { label: "Calmar", value: n(st.calmar) },
    { label: "Beta / ACWI", value: n(st.beta_acwi) }, { label: "Alpha / ACWI", value: st.alpha_acwi == null ? "–" : fmtSigned(st.alpha_acwi), tone: tone(st.alpha_acwi) },
    { label: "Corr. / ACWI", value: n(st.corr_acwi) }, { label: "Up / down capture", value: `${n(st.up_capture)} / ${n(st.down_capture)}` },
    { label: "Tracking error", value: fmtPct(st.tracking_error) }, { label: "Info ratio / 60/40", value: n(st.info_ratio) },
    { label: "VaR 95 (day)", value: fmtPct(st.var95, 2) }, { label: "CVaR 95 (day)", value: fmtPct(st.cvar95, 2) },
    { label: "Best / worst day", value: `${fmtSigned(st.best_day, 2)} / ${fmtSigned(st.worst_day, 2)}` },
    { label: "Days up", value: fmtPct(st.pct_positive, 0) },
  ] : [{ label: "Statistics", value: "–", delta: "after five sessions" }]);
  const D = J.daily || [];
  const charts = [["dk-dd", "dk-pnl", "dk-exp"]];
  if (!D.length) { charts[0].forEach((id) => { $(id).closest(".chart").hidden = true; }); return; }
  charts[0].forEach((id) => { $(id).closest(".chart").hidden = false; });
  draw("dk-dd", lineConfig({ labels: D.map((x) => x.date), yFmt: (v) => fmtPct(v, 1),
    series: [{ label: "Drawdown", data: D.map((x) => x.drawdown), color: tok("--down"), width: 1.5, fill: true }] }));
  draw("dk-pnl", { type: "bar", data: { labels: D.map((x) => x.date), datasets: [
      { label: "Desk", data: D.map((x) => x.day_ret), backgroundColor: D.map((x) => alpha(tok((x.day_ret || 0) >= 0 ? "--up" : "--down"), 0.75)) },
      { label: "Desk − 60/40", data: D.map((x) => x.excess_day), backgroundColor: alpha(tok("--ink-2"), 0.35) }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { callback: (v) => fmtPct(v, 1) } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, callback(v) { return day(this.getLabelForValue(v)).replace(/, \d{4}$/, ""); } } } },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtSigned(c.parsed.y, 2)}` } } } } });
  const beat = D.filter((x) => (x.excess_day || 0) > 0).length;
  $("dk-pnl-meta").textContent = `beat 60/40 on ${beat} of ${D.length} days`;
  draw("dk-exp", lineConfig({ labels: D.map((x) => x.date), yFmt: (v) => fmtPct(v, 0),
    series: [{ label: "Gross", data: D.map((x) => x.gross), color: tok("--accent"), width: 1.8 },
             { label: "Net", data: D.map((x) => x.net), color: tok("--warn"), width: 1.8 }] }));
}

function monthlyGrid() {
  const M = (A.journal || {}).monthly || [];
  const years = [...new Set(M.map((m) => m.month.slice(0, 4)))].sort().reverse();
  const rows = years.map((y) => {
    const r = { year: y };
    let g = 1, b = 1;
    M.filter((m) => m.month.startsWith(y)).forEach((m) => { r[m.month.slice(5)] = m; g *= 1 + (m.book || 0); b *= 1 + (m.sixty_forty || 0); });
    r.ytd = { book: g - 1, excess: g - b };
    return r;
  });
  const cell = (m) => (m ? el("span", { class: tone(m.book), title: `60/40 ${fmtSigned(m.sixty_forty)} · excess ${fmtSigned(m.excess)}`, text: fmtSigned(m.book) }) : "");
  renderTable($("dk-monthly"), rows, [
    { key: "year", label: "Year" },
    ...MONTHS.map((mo, i) => ({ key: String(i + 1).padStart(2, "0"), label: mo, num: true, fmt: (v) => cell(v) })),
    { key: "ytd", label: "Year", num: true, fmt: (v) => el("span", { class: tone(v.book), title: `vs 60/40 ${fmtSigned(v.excess)}`, text: fmtSigned(v.book) }) },
  ], { empty: "The first month fills in after the first fill." });
}

function attributionPanel() {
  const a = (A.journal || {}).attribution;
  if (!a) { $("dk-attr").closest(".chart").hidden = true; $("dk-at-meta").textContent = "after two marked sessions"; return; }
  $("dk-attr").closest(".chart").hidden = false;
  $("dk-at-meta").textContent = `summed daily: ${fmtSigned(a.total_summed, 2)} = lines ${fmtSigned(a.explained, 2)} + costs, borrow and cash ${fmtSigned(a.other, 2)}`;
  const L = [...a.lines].filter((x) => x.symbol !== "SGOV").sort((x, y) => y.contribution - x.contribution);
  const show = L.length > 12 ? [...L.slice(0, 6), ...L.slice(-6)] : L;
  draw("dk-attr", hbarConfig({ labels: show.map((x) => x.symbol), values: show.map((x) => x.contribution * 100),
    colors: show.map((x) => tok(x.contribution >= 0 ? "--up" : "--down")), fmt: (v) => `${Number(v).toFixed(2)}%`,
    valueLabels: show.map((x) => fmtSigned(x.contribution, 2)) }));
  const t = (id, rows, label, f = (v) => v) => renderTable($(id), rows, [
    { key: "key", label, fmt: f }, { key: "contribution", label: "Contribution", num: true, fmt: (v) => cellPct(v) }], { sortKey: "contribution" });
  t("dk-attr-s", a.scenarios, "Scenario");
  t("dk-attr-t", a.types, "Trade type", (v) => String(v).replace("_", " "));
  t("dk-attr-g", a.groups, "Watchlist group", (v) => S?.groups?.[v] || v);
}

function riskPanel() {
  const J = A.journal || {}, r = J.ex_ante;
  $("dk-rk-meta").textContent = J.ahead_is_pending ? "the book after its pending fill" : "the book as held";
  renderStats("dk-risk", r ? [
    { label: "Ex-ante vol", value: fmtPct(r.vol), delta: "target 8%" }, { label: "1-day VaR 95", value: fmtPct(r.var95_1d, 2) },
    { label: "1-day CVaR 95", value: fmtPct(r.cvar95_1d, 2) }, { label: "Beta / ACWI", value: r.beta_acwi == null ? "–" : r.beta_acwi.toFixed(2) },
    { label: "Corr. / ACWI", value: r.corr_acwi == null ? "–" : r.corr_acwi.toFixed(2), tone: (r.corr_acwi || 0) > 0.6 ? "down" : "" },
  ] : [{ label: "Ex-ante risk", value: "–", delta: "nothing at risk: all cash" }]);
  renderTable($("dk-riskshare"), r?.risk_share || [], [
    { key: "symbol", label: "Line" }, { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v) },
    { key: "share", label: "Share of risk", num: true, fmt: (v) => cellPct(v, 1) },
  ], { empty: "No risk lines." });
  const al = J.alignment || [];
  $("dk-al-meta2").textContent = J.ahead_is_pending ? "the book after its pending fill" : "the book as held";
  renderTable($("dk-align"), al, [
    { key: "id", label: "#" }, { key: "name", label: "Scenario" },
    { key: "posterior", label: "Posterior", num: true, fmt: (v) => fmtPct(v, 0) },
    { key: "status", label: "Critics", fmt: (v) => pill(v || "–", v === "kept" ? "on" : "down") },
    { key: "alignment", label: "Book's net bet on it", num: true, fmt: (v) => cellPct(v, 1) },
  ], { sortKey: "alignment", empty: "No scenarios yet." });
}

function journalTables() {
  const J = A.journal || {}, e = J.edge || {};
  const trips = sheetRows(J.trips || []);
  if (!J.workbook) $("dk-xlsx").hidden = true;
  $("dk-edge").replaceChildren(pill(e.verdict || "too early", e.verdict === "edge" ? "up" : e.verdict === "no edge" ? "down" : "warn"), " ",
    e.closed ? `${e.closed} closed trips: mean ${fmtSigned(e.mean, 2)}, hit rate ${fmtPct(e.hit, 0)}, payoff ${e.payoff == null ? "–" : e.payoff.toFixed(2)}, profit factor ${e.profit_factor == null ? "–" : e.profit_factor.toFixed(2)}${e.t == null ? "" : `, t ${e.t.toFixed(2)} on weekly clusters`}. ${e.verdict_why || ""}`
             : (e.verdict_why || "No closed trip yet."));
  renderTable($("dk-trips"), trips, [ROWNUM,
    { key: "symbol", label: "Line" }, { key: "status", label: "Status", fmt: (v) => pill(v, v === "open" ? "warn" : "muted") },
    { key: "side", label: "Side" }, { key: "scenario", label: "Scen." }, { key: "type", label: "Type", fmt: (v) => (v || "").replace("_", " ") },
    { key: "entry_date", label: "Entry", fmt: day }, { key: "avg_entry", label: "Avg in", num: true, fmt: (v) => Number(v).toFixed(2) },
    { key: "exit_date", label: "Exit", fmt: day }, { key: "exit_price", label: "Out", num: true, fmt: (v) => (v == null ? "–" : Number(v).toFixed(2)) },
    { key: "days_held", label: "Sess.", num: true }, { key: "gross_pnl", label: "Gross", num: true, fmt: pnl },
    { key: "costs", label: "Costs", num: true, fmt: (v) => money(v, "USD", 2) }, { key: "net_pnl", label: "Net", num: true, fmt: pnl },
    { key: "ret", label: "Return", num: true, fmt: (v) => cellPct(v) }, { key: "excess_6040", label: "vs 60/40", num: true, fmt: (v) => cellPct(v) },
    { key: "decisions", label: "Decisions", cls: () => "note" },
  ], { empty: "No trades yet." });
  renderTable($("dk-daily"), sheetRows([...(J.daily || [])].reverse()), [ROWNUM,
    { key: "date", label: "Date", fmt: day }, { key: "nav", label: "NAV", num: true, fmt: (v) => usd(v) },
    { key: "day_pnl", label: "Day P&L", num: true, fmt: pnl }, { key: "day_ret", label: "Day", num: true, fmt: (v) => cellPct(v) },
    { key: "cum_ret", label: "Since start", num: true, fmt: (v) => cellPct(v) }, { key: "sixty_forty_cum", label: "60/40", num: true, fmt: (v) => cellPct(v) },
    { key: "excess_day", label: "vs 60/40", num: true, fmt: (v) => cellPct(v) }, { key: "drawdown", label: "Drawdown", num: true, fmt: (v) => fmtPct(v) },
    { key: "gross", label: "Gross", num: true, fmt: (v) => fmtPct(v, 0) }, { key: "net", label: "Net", num: true, fmt: (v) => fmtPct(v, 0) },
    { key: "lines", label: "Lines", num: true },
  ], { empty: "No marked sessions yet." });
}

function mirror() {
  if (!M) { $("dk-al-note").textContent = "The mirror starts once the owner loads its job and adds the third paper account's keys."; $("dk-alp").closest(".chart").hidden = true; return; }
  const s = M.series || [];
  draw("dk-alp", lineConfig({ labels: s.map((x) => x.date), yFmt: (v) => Number(v).toFixed(3),
    series: [{ label: "Alpaca paper account", data: s.map((x) => x.account), color: tok("--accent"), width: 2 },
             { label: "Graded book", data: s.map((x) => x.book), color: tok("--ink-2"), width: 1.4 }] }));
  $("dk-al-meta").textContent = `since ${day(M.start)} · tracking ${M.tracking == null ? "–" : fmtSigned(M.tracking, 2)}`;
  $("dk-al-note").textContent = "Both lines are indexed to 1 on the first mirrored day. The gap is execution: whole shares, skipped shorts, and closing-auction fills.";
  renderTable($("dk-orders"), [...(M.orders || []), ...(M.skips || []).map((k) => ({ date: k.date, symbol: "–", purpose: "skipped", status: k.why }))], [
    { key: "date", label: "Date", fmt: day }, { key: "symbol", label: "Line" }, { key: "purpose", label: "Purpose" },
    { key: "qty", label: "Qty", num: true, fmt: (v) => (v == null ? "–" : Number(v).toFixed(Math.abs(v) < 1 ? 4 : 0)) },
    { key: "status", label: "Status", cls: () => "note" },
  ], { sortKey: "date", empty: "No orders yet." });
}

function decisions() {
  const c = A.scorecard || {};
  const out = Object.fromEntries((c.decisions || []).map((x) => [x.id, x]));
  const rows = (A.decisions || []).map((d) => ({ ...d, ...(out[d.id] || {}), call: d.regime?.call,
    hits: out[d.id]?.tilt_hits ? `${out[d.id].tilt_hits.filter(Boolean).length}/${out[d.id].tilt_hits.length}` : "–" }));
  const h = c.helped || {}, t = c.tilts || {};
  $("ag-d-meta").textContent = `helped ${h.yes ?? 0} of ${h.n ?? 0}${h.p_value != null ? ` (p ${h.p_value})` : ""} · tilts right ${t.right ?? 0} of ${t.n ?? 0}`;
  renderTable($("ag-decisions"), rows, [
    { key: "id", label: "#" },
    { key: "decided_date", label: "Decided", fmt: day },
    { key: "fill_date", label: "Filled", fmt: day },
    { key: "status", label: "Status", fmt: (v) => pill(v, v === "filled" ? "on" : v?.startsWith("superseded") ? "muted" : "warn") },
    { key: "call", label: "Regime call", cls: () => "note" },
    { key: "turnover", label: "Turnover", num: true, fmt: (v) => fmtPct(v) },
    { key: "cost", label: "Cost", num: true, fmt: (v) => (v == null ? "–" : usd(v)) },
    { key: "ret", label: "While held", num: true, fmt: (v) => el("span", { class: tone(v), text: fmtSigned(v, 2) }) },
    { key: "vs_6040", label: "vs 60/40", num: true, fmt: (v) => el("span", { class: tone(v), text: fmtSigned(v, 2) }) },
    { key: "helped", label: "Helped", fmt: (v) => (v == null ? "–" : pill(v ? "yes" : "no", v ? "up" : "down")) },
    { key: "hits", label: "Tilts right" },
  ], { sortKey: "decided_date", empty: "No decisions yet." });
}

function calls() {
  const c = A.scorecard?.calls || {};
  $("ag-r-meta").textContent = c.scored ? `${c.agent_right} of ${c.scored} right vs ${c.persistence_right} for "nothing changes"` : "none scored yet";
  $("ag-r-note").textContent = `Each call is scored ${c.horizon_days || 28} days after the decision against the quadrant the macro state then held, beside the forecast that nothing changes. Brier score (lower is better): desk ${c.brier ?? "–"}, persistence ${c.brier_persistence ?? "–"}.`;
  renderTable($("ag-calls"), c.rows || [], [
    { key: "id", label: "#" }, { key: "call", label: "Desk's call" }, { key: "at_decision", label: "Quadrant then" },
    { key: "outcome", label: "Quadrant 4 weeks on", fmt: (v) => v || "pending" },
    { key: "right", label: "Right", fmt: (v) => (v == null ? "–" : pill(v ? "yes" : "no", v ? "up" : "down")) },
    { key: "brier", label: "Brier", num: true },
  ], { empty: "No calls yet." });
}

function trades() {
  const all = A.trades || [];
  const q = ($("dk-fill-q")?.value || "").trim().toLowerCase();
  const t = q ? all.filter((x) => [x.symbol, x.decision, x.side, x.date].join(" ").toLowerCase().includes(q)) : all;
  $("ag-t-meta").textContent = q ? `${t.length} of ${all.length} fills` : `${all.length} fills`;
  renderTable($("ag-trades"), t, [
    { key: "date", label: "Date", fmt: day }, { key: "decision", label: "Decision" }, { key: "symbol", label: "Line" },
    { key: "side", label: "Side", fmt: (v) => pill(v, v === "buy" || v === "cover" ? "up" : "down") },
    { key: "units", label: "Units", num: true, fmt: (v) => Number(v).toFixed(2) },
    { key: "price", label: "Close", num: true, fmt: (v) => Number(v).toFixed(2) },
    { key: "value", label: "Value", num: true, fmt: (v) => usd(v) },
    { key: "cost", label: "Cost", num: true, fmt: (v) => money(v, "USD", 2) },
  ], { sortKey: "date", empty: "No trades yet." });
}

/* ------------------------------------------------------------------ research */
function research() {
  if (!P) { $("dk-claim").textContent = "The spread lab has not run yet."; return; }
  const c = P.paper_claim;
  $("dk-lab-meta").textContent = `${P.tried} tried · ${P.fdr_pass} pass the FDR · ${(P.usable || []).length} usable · built ${day(P.built)}`;
  $("dk-claim").textContent = c
    ? `The paper's best, SILJ-SLV at 10 days: Sharpe ${c.ins.sharpe} (t ${c.ins.t}) judged on 2015-2020, ${c.oos.sharpe} (t ${c.oos.t}) tested from 2021, net of costs, graded ${c.grade}. ${(P.usable || []).length ? "" : "No spread replicates, so the agent is given no spread signal."}`
    : "";
  const rows = [...(P.rows || [])].sort((a, b) => (b.oos?.t ?? -9) - (a.oos?.t ?? -9)).slice(0, 40)
    .map((r) => ({ ...r, ins_t: r.ins?.t, oos_t: r.oos?.t, oos_sharpe: r.oos?.sharpe, gross: r.oos_gross_sharpe }));
  renderTable($("dk-lab"), rows, [
    { key: "spread", label: "Spread" }, { key: "source", label: "From" }, { key: "h", label: "Days", num: true }, { key: "variant", label: "Rule" },
    { key: "ins_t", label: "t, 2015-20", num: true }, { key: "oos_t", label: "t, 2021 on", num: true },
    { key: "oos_sharpe", label: "Sharpe net", num: true }, { key: "gross", label: "Sharpe gross", num: true },
    { key: "grade", label: "Grade", fmt: (v) => pill(v, GRADE_TONE[v]) },
    { key: "position_now", label: "Today", fmt: (v) => (v == null ? "–" : v > 0 ? "long spread" : v < 0 ? "short spread" : "flat") },
  ], { sortKey: "oos_t" });
}

/* ------------------------------------------------------------------ record */
function record() {
  const r = A.runs || [];
  $("ag-u-meta").textContent = `${r.length} runs`;
  renderTable($("ag-runs"), r, [
    { key: "at", label: "When", fmt: day }, { key: "kind", label: "Kind" },
    { key: "status", label: "Status", fmt: (v) => pill(v, STATUS_TONE[v]) },
    { key: "reasons", label: "Why it failed", cls: () => "note", fmt: (v) => (v && v.length ? v.join("; ") : "–") },
    { key: "stop", label: "Stopped" }, { key: "tool_calls", label: "Tool calls", num: true },
    { key: "list_cost_usd", label: "Generator $", num: true, fmt: (v) => (v == null ? "–" : `$${Number(v).toFixed(2)}`) },
    { key: "critic_cost_usd", label: "Critics $", num: true, fmt: (v) => (v == null ? "–" : `$${Number(v).toFixed(2)}`) },
  ], { sortKey: "at", empty: "No runs yet." });
  renderTable($("ag-log"), A.changes || [], [
    { key: "at", label: "When", fmt: day }, { key: "kind", label: "What" }, { key: "text", label: "Change", cls: () => "note" },
  ], { sortKey: "at", empty: "No changes recorded yet." });
  const a = A.archive;
  $("dk-archive").textContent = a ? `Retired ${day(a.retired)}: ${a.note} (${a.decisions} decision${a.decisions === 1 ? "" : "s"}, ${a.filled} filled, ${a.runs} run${a.runs === 1 ? "" : "s"}).` : "";
  const b = A.briefings || [];
  if (b.length) {
    $("ag-b-panel").hidden = false;
    renderTable($("ag-brief"), b, [
      { key: "at", label: "When", fmt: day }, { key: "title", label: "Title" }, { key: "summary", label: "Summary", cls: () => "note" },
    ], { sortKey: "at" });
  }
  $("ag-rules").textContent = A.rules?.text || "";
  renderTable($("ag-universe"), A.rules?.universe || [], [
    { key: "symbol", label: "Line" }, { key: "bucket", label: "Group" }, { key: "name", label: "What it tells us", cls: () => "note" },
    { key: "cost_bp", label: "Cost a side (bp)", num: true }, { key: "borrow_pct", label: "Borrow %/yr", num: true },
  ]);
}

/* ------------------------------------------------------------------ live, allocation, distribution */
const SPARK = {};

function sessionHours() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short",
    hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const m = (+parts.hour % 24) * 60 + +parts.minute;
  return !["Sat", "Sun"].includes(parts.weekday) && m >= 565 && m <= 990;
}

function liveFresh() {
  return LV && LV.last_mark === A.last_marked && LV.nav != null && Date.now() - new Date(LV.stamp) < 6 * 3600_000;
}

function livePanel() {
  const J = A.journal || {}, D = J.daily || [], last = D[D.length - 1];
  const live = liveFresh();
  if (live) {
    const vs = LV.day_pct != null && LV.sixty_forty_day != null ? LV.day_pct - LV.sixty_forty_day : null;
    ticker($("dk-ticker"), { symbol: "MACRO DESK", name: "paper book · live", value: LV.nav, valueFmt: usd, change: LV.day_pct,
      meta: [["Day P&L", smoney(LV.day_pnl)], ["60/40 today", fmtSigned(LV.sixty_forty_day, 2)], ["ACWI today", fmtSigned(LV.acwi_day, 2)],
             ["vs 60/40", vs == null ? "–" : fmtSigned(vs, 2)], ["Since start", fmtSigned(LV.nav / A.capital - 1)]] });
    $("dk-live-meta").textContent = `prices at ${new Date(LV.stamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET · every 10 min in the session` +
      (LV.unquoted?.length ? ` · no quote for ${LV.unquoted.join(", ")}` : "");
  } else if (last) {
    ticker($("dk-ticker"), { symbol: "MACRO DESK", name: `paper book · close of ${day(last.date)}`, value: last.nav, valueFmt: usd, change: last.day_ret,
      meta: [["Day P&L", smoney(last.day_pnl)], ["vs 60/40", fmtSigned(last.excess_day, 2)], ["Since start", fmtSigned(last.cum_ret)],
             ["Drawdown", fmtPct(last.drawdown)], ["Net / gross", last.net == null ? "–" : `${fmtPct(last.net, 0)} / ${fmtPct(last.gross, 0)}`]] });
    $("dk-live-meta").textContent = "last close; live prices every 10 minutes in the session";
  } else {
    ticker($("dk-ticker"), { symbol: "MACRO DESK", name: "paper book · not started", value: A.capital, valueFmt: usd, change: null,
      meta: [["First fill", A.pending ? `after ${day(A.pending.decided_date)}` : "–"]] });
    $("dk-live-meta").textContent = "goes live once the first target has filled";
  }
  positionsMap();
}

function positionsMap() {
  const host = $("dk-tmap");
  const pos = ((A.journal || {}).positions || []).filter((p) => p.symbol !== "SGOV" && p.value);
  const lv = liveFresh() ? Object.fromEntries((LV.positions || []).map((p) => [p.symbol, p])) : {};
  host.innerHTML = "";
  if (!pos.length) { host.hidden = true; $("dk-tmap-note").textContent = "The map fills in once the book holds risky lines."; return; }
  host.hidden = false;
  const narrow = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  const W = 100, H = narrow ? 130 : 46, px = (host.clientWidth || 1200) / W;
  const total = pos.reduce((s, p) => s + Math.abs(p.value), 0);
  const boxes = [];
  squarify(pos.map((item) => ({ item, area: (Math.abs(item.value) / total) * W * H })), 0, 0, W, H, boxes);
  for (const b of boxes) {
    const p = b.item, g = lv[p.symbol]?.day_pct ?? p.day_pct ?? 0;
    const pnlDir = p.side === "short" ? -g : g;                              // a short gains when the line falls
    const label = `${p.symbol}${p.side === "short" ? " ▼" : ""}`;
    const bw = b.w * px, bh = b.h * px, size = Math.max(10, Math.min(56, (bw - 16) / (0.74 * label.length), bh * 0.42));
    host.appendChild(el("div", { class: "tk-box", tabindex: "0", role: "img",
      "aria-label": `${p.symbol}, ${p.side}, ${fmtPct(p.weight, 1)} of the book, ${fmtSigned(g, 2)} today`,
      style: `left:${b.x}%;top:${(b.y / H) * 100}%;width:${b.w}%;height:${(b.h / H) * 100}%;background:${boxColor(pnlDir, 0.03)}`,
      title: `${p.symbol} · ${p.side} ${fmtPct(Math.abs(p.weight), 1)}\n${fmtSigned(g, 2)} today (${pnlDir >= 0 ? "a gain" : "a loss"} for the book)\n${p.desc || ""}` }, [
      el("span", { class: "tk-box-t", text: label, style: `font-size:${size.toFixed(0)}px` }),
      bh > size * 2.1 && bw > 54 ? el("span", { class: "tk-box-g", text: `${fmtSigned(g, 2)} · ${fmtPct(Math.abs(p.weight), 0)}` }) : null]));
  }
  $("dk-tmap-note").textContent = `box size is the line's weight · colour is ${liveFresh() ? "today's move so far" : "the last session's move"} as P&L for the book (a falling short is green), full at ±3%`;
}

function allocation() {
  const J = A.journal || {};
  let w = Object.fromEntries((J.positions || []).map((p) => [p.symbol, p.weight]));
  let label = "as held";
  if (!Object.keys(w).filter((k) => k !== "SGOV").length && A.pending) { w = A.pending.target; label = "the pending target"; }
  $("dk-alloc-meta").textContent = label;
  const groups = S?.groups || {};
  const net = {}, gross = {};
  for (const [s, v] of Object.entries(w)) {
    if (s === "SGOV") continue;
    const g = (S?.lines || []).find((x) => x.symbol === s)?.group || "other";
    net[g] = (net[g] || 0) + v; gross[g] = (gross[g] || 0) + Math.abs(v);
  }
  const keys = Object.keys(gross).sort((a, b) => gross[b] - gross[a]);
  if (!keys.length) { ["dk-alloc-net", "dk-alloc-gross"].forEach((id) => { $(id).closest(".chart").hidden = true; }); return; }
  ["dk-alloc-net", "dk-alloc-gross"].forEach((id) => { $(id).closest(".chart").hidden = false; });
  draw("dk-alloc-net", hbarConfig({ labels: keys.map((k) => groups[k] || k), values: keys.map((k) => net[k] * 100),
    colors: keys.map((k) => tok(net[k] >= 0 ? "--up" : "--down")), fmt: (v) => `${Number(v).toFixed(0)}%`,
    valueLabels: keys.map((k) => fmtSigned(net[k], 0)) }));
  const cols = keys.map((_, i) => slotColor(i));
  const tot = keys.reduce((a, k) => a + gross[k], 0);
  draw("dk-alloc-gross", doughnutConfig({ labels: keys.map((k) => groups[k] || k), values: keys.map((k) => gross[k] / tot * 100), colors: cols,
    fmt: (v) => `${v.toFixed(1)}% of gross` }));
  $("dk-alloc-legend").replaceChildren(...keys.map((k, i) => el("span", { class: "key" }, [
    el("span", { class: "swatch-rect", style: `background:${cols[i]}` }), el("span", { text: `${groups[k] || k} ${fmtPct(gross[k], 0)}` })])));
}

function distribution() {
  const D = ((A.journal || {}).daily || []).map((x) => x.day_ret).filter((v) => v != null);
  if (D.length < 10) { $("dk-dist").closest(".chart").hidden = true; $("dk-dist-meta").textContent = "after ten sessions"; return; }
  $("dk-dist").closest(".chart").hidden = false;
  const lo = Math.min(...D), hi = Math.max(...D), n = 21, step = (hi - lo) / n || 0.001;
  const bins = Array.from({ length: n }, (_, i) => lo + step * (i + 0.5));
  const counts = bins.map(() => 0);
  D.forEach((v) => { counts[Math.min(n - 1, Math.floor((v - lo) / step))] += 1; });
  draw("dk-dist", { type: "bar", data: { labels: bins.map((b) => fmtSigned(b, 2)), datasets: [{ label: "Sessions", data: counts,
      backgroundColor: bins.map((b) => alpha(tok(b >= 0 ? "--up" : "--down"), 0.7)) }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0 } } } } });
  const m = D.reduce((a, b) => a + b, 0) / D.length;
  $("dk-dist-meta").textContent = `${D.length} sessions · mean ${fmtSigned(m, 3)} · ${D.filter((v) => v > 0).length} up`;
}

async function pollLive() {
  if (!sessionHours()) return;
  try {
    const lv = await loadJSON("data/desk_live.json");
    if (LV && lv.stamp === LV.stamp) return;
    LV = lv; livePanel();
  } catch { /* no live file yet */ }
}

async function main() {
  renderShell();
  applyChartDefaults();
  try { A = await loadJSON("data/macro_agent.json"); } catch { showError($("error"), new Error("The macro desk has not published yet.")); return; }
  [S, P, M, LV] = await Promise.all(["data/desk_snapshot.json", "data/desk_pairs.json", "data/desk_alpaca.json", "data/desk_live.json"]
    .map((f) => loadJSON(f).catch(() => null)));
  (S?.lines || []).forEach((x) => { SPARK[x.symbol] = x.spark; });
  setAsOf(A.latest?.date || A.last_marked || String(A.built).slice(0, 10), "DESK", { maxAge: 4 });
  tabs();
  periodButtons();
  strip(); today(); scenarios(); cross(); livePanel(); allocation(); distribution(); verdict(); chart(); performance(); monthlyGrid(); attributionPanel(); riskPanel(); meketa();
  holdingsTable(); journalTables(); mirror(); decisions(); calls(); trades(); research(); record();
  $("dk-fill-q")?.addEventListener("input", trades);
  setInterval(pollLive, 60_000);
  await news();
  onThemeChange(() => { applyChartDefaults(); today(); scenarios(); cross(); livePanel(); allocation(); distribution(); chart(); performance(); attributionPanel(); mirror(); });
}

main();
