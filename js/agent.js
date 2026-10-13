/* The Macro agent tab: the daily macro desk. Today's scenario, forward scenarios and the critics, the watchlist,
   the news, the paper book and its Alpaca mirror, the research behind it, and every run. */
import { loadJSON, showError, fmtPct, fmtDate, fmtSigned, money, tone, el, renderStats, renderTable, tok, alpha, slotColor } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { applyChartDefaults, draw, lineConfig, hbarConfig } from "./charts.js";

const $ = (id) => document.getElementById(id);
const usd = (x) => money(x, "USD", 0);
const day = (iso) => (iso ? fmtDate(String(iso).slice(0, 10)) : "–");
const VERDICT_TONE = { "EVIDENCE OF SKILL": "up", UNDERPERFORMING: "down", "NO EVIDENCE OF SKILL": "down", UNPROVEN: "", "NOT STARTED": "" };
const STATUS_TONE = { ok: "up", refused: "down", failed: "down", degraded: "warn" };
const GRADE_TONE = { established: "established", replicated: "up", suggestive: "warn", failed: "down", untested: "muted" };
const DIR = { up: 1, down: -1, flat: 0 };
const pill = (text, t) => el("span", { class: `pill ${t || "muted"}`, text });
let A = null, S = null, P = null, M = null;
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
  const p = A.pending;
  $("ag-pending").textContent = p
    ? `Pending: decision ${p.id} of ${day(p.decided_date)} fills at the first close after it: ${Object.entries(p.target).map(([s, w]) => `${s} ${fmtPct(w, 0)}`).join(", ")}.`
    : "No target waiting to fill.";
  $("ag-h-meta").textContent = A.last_marked ? `at the ${day(A.last_marked)} close` : "";
  renderTable($("ag-hold"), A.holdings || [], [
    { key: "symbol", label: "Line" },
    { key: "bucket", label: "Group" },
    { key: "side", label: "Side", fmt: (v) => pill(v, v === "short" ? "down" : "up") },
    { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v) },
    { key: "target", label: "Target", num: true, fmt: (v) => fmtPct(v) },
    { key: "value", label: "Value", num: true, fmt: (v) => usd(v) },
    { key: "scenario", label: "Scenario" },
    { key: "type", label: "Type", fmt: (v) => (v || "").replace("_", " ") },
  ], { sortKey: "value", empty: "Nothing held yet." });
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
  const t = A.trades || [];
  $("ag-t-meta").textContent = `${t.length} trades`;
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

async function main() {
  renderShell();
  applyChartDefaults();
  try { A = await loadJSON("data/macro_agent.json"); } catch { showError($("error"), new Error("The macro desk has not published yet.")); return; }
  [S, P, M] = await Promise.all(["data/desk_snapshot.json", "data/desk_pairs.json", "data/desk_alpaca.json"]
    .map((f) => loadJSON(f).catch(() => null)));
  setAsOf(A.latest?.date || A.last_marked || String(A.built).slice(0, 10), "DESK", { maxAge: 4 });
  tabs();
  periodButtons();
  strip(); today(); scenarios(); cross(); verdict(); chart(); meketa(); holdingsTable(); mirror(); decisions(); calls(); trades(); research(); record();
  await news();
  onThemeChange(() => { applyChartDefaults(); today(); scenarios(); cross(); chart(); mirror(); });
}

main();
