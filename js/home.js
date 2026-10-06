/* Home: dollars managed since the first contribution, how they got there,
   every holding with its share count and history, then the three books.

   tracker.json is the one file on the site that carries dollars and share
   counts (the owner's choice, 2026-10-05); every other page stays relative.
   live.json (live_tracker.py, pushed every ten minutes in market hours)
   re-prices it during the session; the page polls it every minute. */

import {
  loadJSON, showError, fmtPct, fmtNum, fmtDate, el, renderStats, renderTable,
  breakdownColors, tok, alpha, money, signedPct, tone,
} from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { draw, lineConfig, applyChartDefaults } from "./charts.js";

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
let TK = null, BASE = null, LIVE = null, PF = null, VENTURE = null, IBKR = null, mode = "value", mapMode = "day";
let tkTable = null;
const POLL_MS = 60_000;

/* ---------- formatting ---------- */

const shares = (q) => (Number.isInteger(q) ? String(q) : q.toFixed(q < 10 ? 4 : 2).replace(/0+$/, "").replace(/\.$/, ""));

/* ---------- headline ---------- */

function headline() {
  const h = TK.headline;
  $("aum").textContent = money(h.value, "CAD", 2);
  $("aum-lede").textContent =
    `Started at Questrade on ${fmtDate(h.since)} with ${money(h.start_value)}; ${money(h.start_gain)} ` +
    `(${signedPct(h.twr)}) since. Canadian dollars; the USD account converted at ${TK.usdcad.toFixed(4)}.`;
  $("home-meta").textContent = LIVE
    ? `Positions ${LIVE.positions_from === "questrade" ? "read from Questrade" : `as of ${LIVE.positions_from.replace("tracker ", "")}`} at each refresh · both TFSAs`
    : `Positions synced ${TK.as_of} · Questrade, both TFSAs`;
  liveChip();
  const t = today();
  renderStats("tk-strip", [
    { label: LIVE ? "Today" : `Last session`, value: money(t.day), tone: tone(t.day),
      delta: t.pct == null ? "" : `${signedPct(t.pct, 2)}; SPY ${signedPct(t.spy, 2)}` },
    { label: "Started at Questrade", value: money(h.start_value), delta: fmtDate(h.since) },
    { label: "Gain since", value: money(h.start_gain), tone: tone(h.start_gain),
      delta: h.added_since_start ? `excludes ${money(h.added_since_start)} deposited since` : "no deposits since" },
    { label: "Return since", value: signedPct(h.twr), tone: tone(h.twr), delta: `SPY ${signedPct(h.spy)} same dates, ${money(h.spy_value - h.start_value)} on the same money` },
    { label: "Net contributions", value: money(h.contributed),
      delta: `all deposits less withdrawals since ${h.first_contribution.slice(0, 4)}; value is ${money(h.gain)} (${signedPct(h.gain_pct)}) above` },
    { label: "Holdings", value: String(h.positions), delta: `${money(h.cash)} in cash` },
  ]);
}

/* The day's move: from the live snapshot during the session, otherwise the
   last two points of the daily record. */
function today() {
  if (LIVE) return { day: LIVE.headline.day, pct: LIVE.headline.day_pct, spy: LIVE.headline.spy_day_pct };
  const S = TK.series, a = S[S.length - 2], b = S[S.length - 1], d = TK.daily[TK.daily.length - 1];
  if (!a || !b) return { day: null, pct: null, spy: null };
  return { day: b.value - a.value - (b.contributed - a.contributed),
           pct: d && d.date === b.date ? d.fund : null, spy: d && d.date === b.date ? d.spy : null };
}

/* ---------- live prices ---------- */

const etTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/* The snapshot applies only when it is newer than the daily build it
   continues; after the evening run the record itself is newer. */
function applies(live, base) {
  if (!live || live.date < base.as_of) return false;
  return !base.built || new Date(live.stamp) > new Date(base.built);
}

function merge(base, live) {
  const was = new Map(base.holdings.map((h) => [`${h.book}|${h.symbol}`, h]));
  const holdings = live.holdings.map((h) => {
    const o = was.get(`${h.book}|${h.symbol}`) || {};
    return { latest: null, history: [], spark: null, spark_from: null, record_date: live.date, ...o, ...h,
             avg_price: h.avg_price ?? o.avg_price ?? null };
  });
  return {
    ...base, usdcad: live.usdcad, holdings,
    headline: { ...base.headline, ...live.headline },
    series: base.series.filter((p) => p.date < live.date).concat([live.point]),
    daily: (base.daily || []).filter((d) => d.date < live.date).concat([live.daily]),
  };
}

function liveChip() {
  const n = $("tk-live"); if (!n) return;
  n.className = "live-chip";
  if (!LIVE) {
    n.classList.add("closed");
    n.textContent = `Closing prices, ${fmtDate(TK.as_of)}`;
    return;
  }
  const age = (Date.now() - new Date(LIVE.stamp)) / 60000;
  const late = age > LIVE.every_min * 2.5;
  if (LIVE.market === "open" && !late) {
    n.classList.add("on");
    n.textContent = LIVE.streaming
      ? `Live · prices at ${new Date(LIVE.stamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" })} ET · every ${CFG.poll_seconds || 15} s`
      : `Live · prices at ${etTime(LIVE.stamp)} ET · refreshed every ${LIVE.every_min} min`;
  } else if (LIVE.market === "open") {
    n.classList.add("late");
    n.textContent = `Live feed paused · last prices ${etTime(LIVE.stamp)} ET`;
  } else {
    n.classList.add("closed");
    n.textContent = `Closing prices · ${fmtDate(LIVE.date)}, ${etTime(LIVE.stamp)} ET`;
  }
}

/* Weekdays 9:25-16:30 New York: the only hours live.json can change. */
function sessionHours() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short",
    hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const m = (+parts.hour % 24) * 60 + +parts.minute;
  return !["Sat", "Sun"].includes(parts.weekday) && m >= 565 && m <= 990;
}

async function poll() {
  if (!sessionHours()) { liveChip(); return; }
  let live;
  try { live = await loadJSON("data/live.json"); } catch { liveChip(); return; }
  if (!applies(live, BASE)) { liveChip(); return; }
  PUSHED = live;                                   // the freshest Questrade positions
  if (LIVE?.streaming && Date.now() - new Date(LIVE.stamp) < 60_000) return;   // the Worker is ahead
  if (LIVE && live.stamp === LIVE.stamp) { liveChip(); return; }
  LIVE = live; TK = merge(BASE, live);
  headline(); paint(); table();
}

/* ---------- streaming quotes (Cloudflare Worker, optional) ---------- */

/* With docs/data/live_config.json naming a Worker (workers/live-quotes), the
   page asks it for quotes every few seconds in session and re-prices the
   holdings itself, by the same arithmetic as live_tracker.py: positions and
   cash from the last pushed snapshot (Questrade), else the daily record;
   today's change from the last close in the record. */
let CFG = null, PUSHED = null;
const todayET = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

function liveFromQuotes(Q) {
  const day = todayET();
  const src = PUSHED && PUSHED.date === day ? PUSHED : null;
  const fx = Q.usdcad?.price ?? src?.usdcad ?? BASE.usdcad;
  const fxPrev = Q.usdcad?.previousClose ?? fx;
  const prior = BASE.series.filter((p) => p.date < day), b0 = prior[prior.length - 1];
  if (!b0) return null;
  const cash = src ? src.headline.cash : BASE.headline.cash;
  let total = cash;
  const holdings = (src ? src.holdings : BASE.holdings).map((h) => {
    const q = Q.quotes?.[h.price_symbol || h.symbol];
    const pc = h.price_currency || h.currency, same = pc === h.currency;
    const price = q?.price ?? h.price, prev = q?.previousClose ?? h.prev_close;
    const toCad = pc === "USD" ? fx : 1, vc = h.shares * price * toCad;
    total += vc;
    return { ...h, price, prev_close: prev, day_pct: prev ? price / prev - 1 : null,
             value: vc / (h.currency === "USD" ? fx : 1), value_cad: vc, quoted: !!q,
             vs_avg: h.avg_price && same ? price / h.avg_price - 1 : h.vs_avg,
             gain: h.avg_price && same ? (price - h.avg_price) * h.shares * toCad : h.gain };
  });
  holdings.forEach((h) => { h.weight = h.value_cad / total; });
  holdings.sort((a, b) => b.value_cad - a.value_cad);
  const contributed = BASE.series[BASE.series.length - 1].contributed, flow = contributed - b0.contributed;
  const r = (total - b0.value - flow) / (b0.value + 0.5 * flow);
  const spy = Q.quotes?.SPY;
  const rs = spy && spy.previousClose ? (spy.price * fx) / (spy.previousClose * fxPrev) - 1 : 0;
  const H = BASE.headline, twr = b0.twr * (1 + r), spyIdx = b0.spy * (1 + rs), spyVal = b0.spy_value * (1 + rs) + flow;
  return {
    stamp: Q.at, date: day, market: "open", streaming: true, every_min: (CFG.poll_seconds || 15) / 60,
    positions_from: src ? src.positions_from : `tracker ${BASE.as_of}`, usdcad: fx,
    headline: { value: total, cash, positions: holdings.length, contributed,
                start_gain: total - H.start_value - H.added_since_start, gain: total - contributed,
                gain_pct: total / contributed - 1, twr: twr / 100 - 1, spy: spyIdx / 100 - 1, spy_value: spyVal,
                day: total - b0.value - flow, day_pct: r, spy_day_pct: rs },
    point: { date: day, value: total, contributed, kind: "live", twr, spy: spyIdx, spy_value: spyVal },
    daily: { date: day, fund: r, spy: rs },
    holdings,
  };
}

async function tick() {
  if (document.hidden || !sessionHours() || !CFG?.worker_url) return;
  try {
    // The Worker answers only a page that holds the site key (workers/live-quotes).
    const k = sessionStorage.getItem("site-key");
    const tok = k ? btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256",
      Uint8Array.from(atob(k), (c) => c.charCodeAt(0)))))) : "";
    const res = await fetch(`${CFG.worker_url.replace(/\/$/, "")}/quotes`, { cache: "no-store", headers: { "x-site-token": tok } });
    if (!res.ok) return;
    const live = liveFromQuotes(await res.json());
    if (!live) return;
    LIVE = live; TK = merge(BASE, live);
    headline(); paint(); table();
  } catch { /* keep the last prices; the minute poll of live.json still runs */ }
}

/* ---------- performance ---------- */

/* Every calendar day from the first point to the last, so a month that has
   one statement value takes a month of width, not a day's. Days without a
   value are gaps the lines are drawn straight across. */
function byDay(S) {
  const at = new Map(S.map((p) => [p.date, p]));
  const out = [];
  const d = new Date(S[0].date + "T00:00:00Z"), end = new Date(S[S.length - 1].date + "T00:00:00Z");
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    out.push(at.get(k) || { date: k });
  }
  return out;
}

function performance() {
  const S = byDay(TK.series), labels = S.map((p) => p.date);
  const ink = tok("--ink"), muted = tok("--muted"), accent = tok("--accent");
  let series, fmt, legend;
  if (mode === "value") {
    series = [
      { label: "Value", data: S.map((p) => p.value ?? null), color: accent, fill: true },
      { label: "Net contributions", data: S.map((p) => p.contributed ?? null), color: muted, dash: [5, 4], width: 1.5 },
    ];
    fmt = (v) => money(v);
    legend = [["Value", accent], ["Net contributions", muted]];
  } else {
    series = [
      { label: "Portfolio", data: S.map((p) => (p.twr == null ? null : p.twr - 100)), color: accent, width: 2 },
      { label: "SPY", data: S.map((p) => (p.spy == null ? null : p.spy - 100)), color: ink, width: 1.25, dash: [3, 3] },
    ];
    fmt = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
    legend = [["Portfolio, time-weighted", accent], ["SPY, dividends in after US withholding", ink]];
  }
  const cfg = lineConfig({ labels, series, yFmt: fmt });
  if (mode === "value") cfg.data.datasets[1].stepped = true;
  cfg.data.datasets.forEach((d) => { d.spanGaps = true; d.data = d.data.map((v) => (v == null || Number.isNaN(v) ? null : v)); });
  cfg.options.plugins.legend = { display: false };      // the HTML legend above carries it
  draw("tk-chart", cfg);
  const lg = $("tk-legend"); lg.innerHTML = "";
  legend.forEach(([t, c]) => lg.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-line", style: `border-top-color:${c}` }), el("span", { text: t })])));
  const m = TK.method, c = m.check;
  $("tk-note").textContent =
    (mode === "value"
      ? `Daily from ${fmtDate(TK.chart_from)}, the day everything was at Questrade. The dashed line is net contributions, all the money put in since 2024 less withdrawals. The comparison with SPY is under Return. `
      : `Time-weighted from ${fmtDate(TK.chart_from)}, against SPY with dividends reinvested after the 15% US withholding a TFSA pays, in Canadian dollars, over the same dates; each period's return leaves out money deposited in it. `) +
    `The daily values are rebuilt from every trade and priced at each close; on the ${c.points} days ` +
    `the sync recorded a value since ${fmtDate(c.since)}, the rebuild was within ${fmtPct(c.worst_gap, 1)} of it.`;
}

/* ---------- daily return vs SPY ---------- */

function daily() {
  const D = TK.daily || [];
  if (!D.length) return;
  const accent = tok("--accent"), ink = tok("--ink-2"), grid = tok("--grid"), base = tok("--baseline");
  const pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
  const labels = D.map((d) => d.date);
  draw("tk-daily", {
    type: "bar",
    data: { labels, datasets: [
      { label: "Fund", data: D.map((d) => d.fund * 100), backgroundColor: accent, borderRadius: 1, barPercentage: 0.9, categoryPercentage: 0.8 },
      { label: "SPY", data: D.map((d) => d.spy * 100), backgroundColor: alpha(ink, 0.55), borderRadius: 1, barPercentage: 0.9, categoryPercentage: 0.8 },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          title: (it) => fmtDate(labels[it[0].dataIndex]),
          label: (c) => ` ${c.dataset.label}: ${pct(c.parsed.y)}`,
          footer: (it) => { const d = D[it[0].dataIndex]; const x = (d.fund - d.spy) * 100;
                            return `Fund ${x >= 0 ? "ahead" : "behind"} by ${Math.abs(x).toFixed(2)} pts`; },
        } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: base },
             ticks: { maxTicksLimit: 8, autoSkip: true, maxRotation: 0,
                      callback: (v, i) => fmtDate(labels[i]).replace(/, \d{4}$/, "") } },
        y: { grid: { color: (c) => (c.tick.value === 0 ? base : grid) }, border: { display: false },
             ticks: { callback: (v) => `${v > 0 ? "+" : ""}${v}%` } },
      },
    },
  });
  const lg = $("tk-daily-legend"); lg.innerHTML = "";
  [["Fund", accent], ["SPY", alpha(ink, 0.55)]].forEach(([t, c]) =>
    lg.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-rect", style: `background:${c}` }), el("span", { text: t })])));
  const ahead = D.filter((d) => d.fund > d.spy).length;
  const opp = D.filter((d) => Math.sign(d.fund) !== Math.sign(d.spy) && d.fund !== 0 && d.spy !== 0).length;
  const mean = (k) => D.reduce((s, d) => s + d[k], 0) / D.length;
  $("tk-daily-meta").textContent = `${D.length} trading days since ${fmtDate(TK.headline.since)}` +
    (LIVE && LIVE.market === "open" ? " · today's bar is live" : "");
  $("tk-daily-note").textContent =
    `The fund beat SPY on ${ahead} of ${D.length} days and moved the opposite way on ${opp}. ` +
    `Average day: fund ${pct(mean("fund") * 100)}, SPY ${pct(mean("spy") * 100)}. ` +
    "Each bar is one US trading day's return; SPY with dividends reinvested net of the 15% TFSA withholding, both in Canadian dollars, so a move in the " +
    "exchange rate shows in both.";
}

/* ---------- attribution and the model ---------- */

let AT = null;
const pts = (x, dp = 2) => (x == null ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(dp)} pts`);

function attribution() {
  const panel = $("at-panel");
  if (!AT) { if (panel) panel.hidden = true; return; }
  const S = AT.summary;
  $("at-meta").textContent = `${fmtDate(AT.since)} to ${fmtDate(AT.as_of)} · ${AT.days} days`;
  renderStats("at-strip", [
    { label: "Return, time-weighted", value: signedPct(S.twr), tone: tone(S.twr), delta: `SPY ${signedPct(S.spy)}; blended ${signedPct(S.blended)}` },
    { label: "From the stocks", value: pts(S.explained - S.currency), tone: tone(S.explained - S.currency), delta: "price moves, in their own currency" },
    { label: "From the US dollar", value: pts(S.currency), tone: tone(S.currency), delta: "USD/CAD on the US holdings" },
    { label: "Other", value: pts(S.other), tone: tone(S.other), delta: "options, a fee rebate, fills, compounding" },
    { label: "Money-weighted", value: S.mwr_since_first == null ? "–" : `${signedPct(S.mwr_since_first)} a year`,
      delta: `every deposit since ${S.first_deposit.slice(0, 4)}, timing included` },
  ]);
  const H = AT.holdings, top = H.slice(0, 5), bottom = H.slice(-5).filter((r) => !top.includes(r)).reverse();
  const max = Math.max(...H.map((r) => Math.abs(r.contribution)), 1e-9);
  const bars = $("at-bars"); bars.innerHTML = "";
  for (const r of [...top, ...bottom.reverse()]) {
    bars.appendChild(el("div", { class: "pf-d" }, [
      el("span", { class: "sym", text: r.ticker, title: r.held ? "" : "no longer held" }),
      el("span", { class: "pf-bar" }, [el("i", { class: r.contribution >= 0 ? "up" : "down",
        style: `width:${(Math.abs(r.contribution) / max) * 50}%;${r.contribution >= 0 ? "left:50%" : "right:50%"}` })]),
      el("span", { class: `pf-c ${tone(r.contribution)}`, text: pts(r.contribution) }),
      el("span", { class: "note", text: r.held ? (r.sector || "") : "sold" }),
    ]));
  }
  renderTable($("at-sectors"), AT.sectors.filter((r) => r.weight > 0.005 || Math.abs(r.total) > 0.001), [
    { key: "sector", label: "Sector" },
    { key: "weight", label: "Weight", num: true, fmt: (v, r) => `${fmtPct(v, 0)} / ${fmtPct(r.bench_weight, 0)}` },
    { key: "allocation", label: "Allocation", num: true, fmt: (v) => el("span", { class: `tk-vs ${tone(v)}`, text: pts(v) }) },
    { key: "selection", label: "Selection", num: true, fmt: (v) => el("span", { class: `tk-vs ${tone(v)}`, text: pts(v) }) },
  ], { sortKey: "selection", dir: -1 });
  const F = AT.factors;
  $("at-factors").textContent = F
    ? `Exposures of today's holdings over the last ${F.days} days: ` + F.exposures.map((e) =>
        `${e.factor} ${e.beta >= 0 ? "+" : "−"}${Math.abs(e.beta).toFixed(2)} (t ${e.t})`).join(", ") +
      `; ${Math.round(F.r2 * 100)}% of daily moves explained. A market beta above one means the book moves more than SPY.`
    : "";
  $("at-note").textContent = `Weight shows the book's share then SPY's. ${AT.method.contribution} ${AT.method.sectors} ${AT.method.other} ${AT.method.blended}`;
}

function modelVsHeld() {
  const M = AT?.model_vs_held, panel = $("mv-panel");
  if (!M) { if (panel) panel.hidden = true; return; }
  $("mv-meta").textContent = `USD book · ${fmtPct(M.drift_one_way, 1)} of it would have to trade to match`;
  renderTable($("mv-table"), M.rows.slice(0, 12), [
    { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "target", label: "Model", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "held", label: "Held", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "gap", label: "Gap", num: true, fmt: (v) => el("span", { class: `tk-vs ${tone(v)}`, text: signedPct(v, 1) }) },
  ], { sortKey: "gap", dir: -1 });
  $("mv-note").textContent = `The twelve largest gaps of ${M.rows.length}. ${AT.method.model} ${M.drift_note || ""}`;
}

/* ---------- holdings against the bottlenecks ---------- */

let BN = null;

function bottlenecks() {
  if (!BN) { const b = $("bn-panel"); if (b) b.hidden = true; return; }
  const rows = BN.lines.map((l) => ({ ...l, buysN: (l.lens?.buys || []).length, sellsN: (l.lens?.sells || []).filter((x) => x.live).length }));
  renderTable($("bn-table"), rows, [
    { key: "symbol", label: "Holding", fmt: (v, r) => el("span", { class: "tk-sym" }, [el("span", { class: "sym", text: v }), el("span", { class: `tk-ccy ${r.book}`, text: r.book.toUpperCase() })]) },
    { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "buysN", label: "Short of / buying (one of the 110)", fmt: (v, r) => !r.lens?.in_110 ? el("span", { class: "muted", text: "not one of the 110" })
        : (r.lens.buys.length ? el("span", { class: "flags" }, r.lens.buys.slice(0, 3).map((b) => el("span", { class: `pill ${b.how === "short of it" ? "on" : "book"}`, text: b.label, title: b.how }))) : el("span", { class: "muted", text: "nothing shared" })) },
    { key: "sellsN", label: "Sells into a bottleneck (its 10-K)", fmt: (v, r) => (r.lens?.sells || []).length
        ? el("span", { class: "flags" }, r.lens.sells.map((x) => el("span", { class: `pill ${x.live ? "established" : "muted"}`, title: `${(x.exposure * 100).toFixed(0)}% of its business description; ${x.live ? "a live bottleneck" : "not short at the largest firms now"}`, text: `${x.label} ${(x.exposure * 100).toFixed(0)}%` })))
        : el("span", { class: "muted", text: r.lens?.note || "none at 5% or more" }) },
  ], { sortKey: "weight", dir: -1 });
  const live = rows.filter((r) => r.sellsN > 0);
  $("bn-meta").textContent = `${live.length} holdings, ${fmtPct(live.reduce((s, r) => s + r.weight, 0), 0)} of the portfolio, sell into a live bottleneck`;
  $("bn-note").textContent =
    "Short of / buying: needs the holding itself names in its filings, when it is one of the 110 largest firms the demand tree reads. " +
    "Sells into: needs that are at least 5% of its own 10-K business description; green when the largest firms are short of it or buying more of it now. " +
    "Selling into a bottleneck has not been tested against returns.";
}

/* ---------- holdings map (squarified treemap) ---------- */

function squarify(items, x, y, w, h, out) {
  if (!items.length) return;
  if (items.length === 1) { out.push({ ...items[0], x, y, w, h }); return; }
  const total = items.reduce((s, i) => s + i.area, 0);
  const side = Math.min(w, h);
  let row = [], best = Infinity, i = 0;
  const worst = (r) => {
    const s = r.reduce((a, b) => a + b.area, 0), mx = Math.max(...r.map((q) => q.area)), mn = Math.min(...r.map((q) => q.area));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  for (; i < items.length; i++) {
    const next = worst(row.concat(items[i]));
    if (row.length && next > best) break;
    row.push(items[i]); best = next;
  }
  const rs = row.reduce((a, b) => a + b.area, 0);
  if (w >= h) {
    const rw = rs / h; let yy = y;
    row.forEach((r) => { const rh = r.area / rw; out.push({ ...r, x, y: yy, w: rw, h: rh }); yy += rh; });
    squarify(items.slice(i), x + rw, y, w - rw, h, out);
  } else {
    const rh = rs / w; let xx = x;
    row.forEach((r) => { const cw = r.area / rh; out.push({ ...r, x: xx, y, w: cw, h: rh }); xx += cw; });
    squarify(items.slice(i), x, y + rh, w, h - rh, out);
  }
  void total;
}

/* Solid fills, the way a holdings map reads at a glance: green for a gain
   (on the day, or on average cost), red for a loss, deeper the larger it is. The colours are the
   same in both themes — the map carries its own ground, like a chart does —
   and the text is white on every box. */
function boxColor(g, full = 0.3) {
  const k = Math.min(1, Math.abs(g) / full);           // full strength at ±30% on cost, ±3% on the day
  // A flat move is grey, so a −0.02% day does not read like a −2% one.
  return g >= 0
    ? `hsl(110, ${6 + 36 * k}%, ${30 + 15 * k}%)`
    : `hsl(5, ${6 + 52 * k}%, ${30 + 14 * k}%)`;
}

function heatmap() {
  const host = $("tk-map");
  const note = $("tk-map-note");
  if (note) note.textContent = mapMode === "day"
    ? `box size is value · colour is ${LIVE && LIVE.market === "open" ? "today's move so far" : "the last session's move"}, full at ±3%`
    : "box size is value · colour is gain on average cost, full at ±30%";
  host.innerHTML = "";
  const narrow = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  const W = 100, H = narrow ? 130 : 46;           // percent units; the box's aspect is set in CSS
  const px = (host.clientWidth || 1200) / W;      // CSS pixels per unit, for sizing the type
  const total = TK.holdings.reduce((s, h) => s + h.value_cad, 0);
  // `item`, not `h`: squarify adds the box's own x, y, w, h to each entry.
  const items = TK.holdings.map((item) => ({ item, area: (item.value_cad / total) * W * H }));
  const boxes = [];
  squarify(items, 0, 0, W, H, boxes);
  for (const b of boxes) {
    const day = mapMode === "day";
    const t = b.item.ticker, g = (day ? b.item.day_pct : b.item.vs_avg) ?? 0;
    const bw = b.w * px, bh = b.h * px;
    // The ticker fills the box: as wide as fits, never taller than about half of it.
    const size = Math.max(10, Math.min(64, (bw - 16) / (0.74 * t.length), bh * 0.42));
    const showPct = bh > size * 2.1 && bw > 54;
    const said = `${t}, ${b.item.name}: ${signedPct(b.item.day_pct, 2)} today, ${signedPct(b.item.vs_avg)} on average cost, ` +
                 `${fmtPct(b.item.weight, 1)} of the portfolio, ${money(b.item.value_cad)}`;
    host.appendChild(el("div", {
      class: "tk-box", tabindex: "0", role: "img", "aria-label": said,
      style: `left:${b.x}%;top:${(b.y / H) * 100}%;width:${b.w}%;height:${(b.h / H) * 100}%;background:${boxColor(g, day ? 0.03 : 0.3)}`,
      title: `${t} · ${b.item.name}\n${fmtPct(b.item.weight, 1)} of the portfolio · ${money(b.item.value_cad)}\n` +
             `${signedPct(b.item.day_pct, 2)} today · ${signedPct(b.item.vs_avg)} on average cost`,
    }, [
      el("span", { class: "tk-box-t", text: t, style: `font-size:${size.toFixed(0)}px` }),
      showPct ? el("span", { class: "tk-box-g", text: `${signedPct(g, day ? 2 : 1)} · ${fmtPct(b.item.weight, 1)}`,
                              style: `font-size:${Math.max(10, Math.min(15, size * 0.3)).toFixed(0)}px` }) : null,
    ]));
  }
}

/* ---------- small charts ---------- */

function svg(w, h, kids, label) {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${h}`);
  s.setAttribute("width", String(w)); s.setAttribute("height", String(h));
  s.setAttribute("role", "img"); s.setAttribute("aria-label", label);
  kids.forEach((k) => s.appendChild(k));
  return s;
}
function node(tag, attrs) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function ownershipBars(hist) {
  const W = 96, H = 34, n = hist.length, max = Math.max(...hist.map((p) => p.shares), 1e-9);
  const bw = Math.max(3, Math.min(12, (W - (n - 1) * 2) / n));
  const kids = hist.map((p, i) => {
    const bh = Math.max(p.shares > 0 ? 2 : 0, (p.shares / max) * (H - 2));
    return node("rect", { x: W - (n - i) * (bw + 2) + 2, y: H - bh, width: bw, height: bh, class: "tk-bar" });
  });
  kids.push(node("line", { x1: 0, x2: W, y1: H - 0.5, y2: H - 0.5, class: "tk-base" }));
  return svg(W, H, kids, `Shares held at month-ends: ${hist.map((p) => `${p.date.slice(0, 7)} ${shares(p.shares)}`).join(", ")}`);
}

function sparkline(vals, from) {
  const W = 110, H = 34;
  if (!vals || vals.length < 2) return el("span", { class: "muted", text: "—" });
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, H - 2 - ((v - lo) / span) * (H - 4)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const dir = vals[vals.length - 1] >= vals[0] ? "up" : "down";
  return svg(W, H, [
    node("path", { d: `${line}L${W},${H}L0,${H}Z`, class: `tk-area ${dir}` }),
    node("path", { d: line, class: `tk-line ${dir}` }),
  ], `Price since ${from}: ${dir}, ${signedPct(vals[vals.length - 1] / vals[0] - 1)}`);
}

/* ---------- the table ---------- */

const ACTION = { buy: "Bought", sell: "Sold", "transfer in": "Moved in", "transfer out": "Moved out", journal: "Journal", split: "Split", held: "Held" };

function activityCell(h) {
  const a = h.latest;
  if (!a || !a.date) return el("span", { class: "muted", text: "—" });
  const dir = a.shares > 0 ? "up" : a.shares < 0 ? "down" : "";
  const head = a.pct == null
    ? el("span", { class: `tk-act ${dir}`, text: a.action === "buy" ? "New" : ACTION[a.action] || a.action })
    : el("span", { class: `tk-act ${dir}`, text: `${dir === "up" ? "▲" : dir === "down" ? "▼" : ""} ${Math.abs(a.pct * 100).toFixed(1)}%` });
  return el("span", { class: "tk-actcell", title: `${ACTION[a.action] || a.action} ${shares(Math.abs(a.shares))} shares on ${a.date}` }, [
    head, el("span", { class: "tk-delta", text: `(${a.shares > 0 ? "+" : "−"}${shares(Math.abs(a.shares))})` }),
  ]);
}

function table() {
  const rows = TK.holdings.map((h) => ({ ...h, act: h.latest?.pct ?? (h.latest?.shares > 0 ? 9 : -9) }));
  const sort = tkTable ? tkTable.sort() : { sortKey: "weight", dir: -1 };
  tkTable = renderTable($("tk-table"), rows, [
    { key: "ticker", label: "Stock", fmt: (v, r) => el("span", { class: "tk-sym" }, [
        el("span", { class: "sym", text: v }), el("span", { class: `tk-ccy ${r.book}`, text: r.currency })]) },
    { key: "name", label: "Company", cls: () => "tk-name" },
    { key: "weight", label: "% of portfolio", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "shares", label: "Shares", num: true, fmt: (v) => shares(v) },
    { key: "value_cad", label: "Value", num: true, fmt: (v, r) => el("span", { title: r.currency === "USD" ? `${money(v)} at today's rate` : "" , text: money(r.value, r.currency) }) },
    { key: "day_pct", label: LIVE && LIVE.market === "open" ? "Today" : "Last day", num: true,
      fmt: (v, r) => el("span", { class: `tk-vs ${tone(v)}`, title: r.price == null ? "" : `${money(r.price, r.currency, 2)} a share`, text: signedPct(v, 2) }) },
    { key: "act", label: "Latest activity", fmt: (v, r) => activityCell(r) },
    { key: "history", label: "Ownership", fmt: (v) => ownershipBars(v) },
    { key: "vs_avg", label: "Avg buy price", num: true, fmt: (v, r) => el("span", { class: "tk-avg" }, [
        el("span", { text: r.avg_price == null ? "–" : money(r.avg_price, r.currency, 2) }),
        el("span", { class: `tk-vs ${tone(v)}`, text: ` (${signedPct(v)})` })]) },
    { key: "spark", label: "Price, 1 year", fmt: (v, r) => sparkline(v, r.spark_from) },
    { key: "record_date", label: "Date", fmt: (v) => el("span", { class: "tk-date", text: v }) },
  ], sort);
  $("tk-count").textContent = `${TK.holdings.length} positions · sorted by size · click a heading to sort`;
  const un = TK.method.unpriced.map((u) => u.symbol);
  $("tk-method").textContent =
    "Value is in each line's own currency; % of portfolio uses Canadian dollars at today's rate. Average buy price is " +
    "Questrade's book cost, which carries the CIBC cost over for shares moved in kind. Ownership bars are the share count " +
    "at each month-end, followed back through journals, the internal transfer between the two accounts and the move from " +
    "CIBC. Date is the last change in the position." + (un.length ? ` ${un.join(", ")} is not priced by the data vendor and is held at its traded price.` : "");
}

/* ---------- the books, compact ---------- */

const run = (b) => (b.managed_by === "model" ? "run by the engine" : b.managed_by === "screen" ? "run by the screen" : "run by hand");

function bookCard(key, b, link, rows, foot) {
  const colors = breakdownColors(rows.length);
  return el("article", { class: "book-card compact", "data-book": key }, [
    el("div", { class: "book-card-h" }, [
      el("span", { class: "book-tag", text: b.currency }),
      el("h3", { class: "book-name", text: b.label }),
      el("span", { class: "book-run", text: run(b) }),
    ]),
    el("p", { class: "mandate", text: b.mandate }),
    el("div", { class: "stack-bar", role: "img", "aria-label": rows.map((p) => `${p.symbol} ${fmtPct(p.weight, 1)}`).join(", ") },
      rows.map((p, i) => el("i", { style: `flex:${p.weight};background:${colors[i]}`, title: `${p.symbol} ${fmtPct(p.weight, 1)}` }))),
    el("p", { class: "note", text: foot }),
    el("a", { class: "book-link", href: link, text: `Open the ${b.label} →` }),
  ]);
}

function books() {
  const host = $("books"); host.innerHTML = "";
  for (const key of ["usd", "cad"]) {
    const b = PF?.books?.[key]; if (!b) continue;
    const rows = [...b.positions].sort((x, y) => y.weight - x.weight);
    host.appendChild(bookCard(key, b, `${key}/index.html`, rows,
      `${b.n_positions} positions · ${fmtPct(b.share_of_total, 0)} of the money`));
  }
  if (IBKR?.positions) {
    const h = IBKR.headline, c = IBKR.coverage;
    const rows = [...IBKR.positions.map((x) => ({ symbol: x.symbol, weight: x.value / h.nav })),
                  { symbol: "Cash", weight: Math.max(h.nav - h.invested, 0) / h.nav }];
    host.appendChild(bookCard("ibkr", { label: "IBKR income account", currency: "CAD", managed_by: "hand",
      mandate: "One monthly-paying income fund and cash, held so its distribution pays the market-data subscription the price jobs use." },
      "ibkr.html", rows,
      `${c.covers ? `Distribution covers the data bill ${c.ratio.toFixed(1)}×` : `Distribution covers ${Math.round(c.ratio * 100)}% of the data bill`} · ${money(h.nav)}`));
  }
  if (VENTURE?.portfolio?.length) {
    const b = VENTURE.book || { label: "Venture book", currency: "USD", managed_by: "screen", mandate: "" };
    host.appendChild(bookCard("venture", b, "venture/index.html", VENTURE.portfolio,
      `${VENTURE.portfolio.length} names at equal weight · unfunded`));
  }
}

function paint() { performance(); daily(); heatmap(); }

(async function init() {
  renderShell();
  try {
    TK = await loadJSON("data/tracker.json");
  } catch (err) {
    showError($("error"), err); return;
  }
  const [pf, v, pj, ib] = await Promise.allSettled([loadJSON("data/current_portfolio.json"), loadJSON("data/venture_card.json"),
    loadJSON("data/holdings_bottlenecks.json"), loadJSON("data/ibkr.json")]);
  IBKR = ib.status === "fulfilled" ? ib.value : null;
  AT = await loadJSON("data/attribution.json").catch(() => null);
  PF = pf.status === "fulfilled" ? pf.value : null;
  VENTURE = v.status === "fulfilled" ? v.value : null;
  BN = pj.status === "fulfilled" ? pj.value : null;
  BASE = TK;
  try { const l = await loadJSON("data/live.json"); if (applies(l, BASE)) { LIVE = PUSHED = l; TK = merge(BASE, l); } } catch { /* no live file yet */ }
  setAsOf(TK.as_of);
  headline(); paint(); attribution(); modelVsHeld(); bottlenecks(); table(); books();
  // Live prices: poll while the tab is visible, and once on coming back.
  CFG = await loadJSON("data/live_config.json").catch(() => null);
  if (CFG?.worker_url) { tick(); setInterval(tick, (CFG.poll_seconds || 15) * 1000); }
  let timer = setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    clearInterval(timer);
    if (!document.hidden) { poll(); timer = setInterval(poll, POLL_MS); }
  });
  $("tk-mapmode")?.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button"); if (!b) return;
    mapMode = b.dataset.mode;
    [...$("tk-mapmode").children].forEach((x) => x.classList.toggle("active", x === b));
    heatmap();
  });
  const btns = [];
  $("tk-mode").addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button"); if (!b) return;
    mode = b.dataset.mode;
    btns.forEach((x) => x.classList.toggle("active", x === b));
    performance();
  });
  ["value", "return"].forEach((m, i) => { const b = $("tk-mode").children?.[i]; if (b) btns.push(b); });
  onThemeChange(() => { applyChartDefaults(); paint(); });
  // Type is sized in pixels, so the map is laid out again when its width changes.
  let t = null;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(heatmap, 120); });
})();
