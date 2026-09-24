/* The live vol surface: reads docs/data/vol_surface.json, polls it, draws
   the surface, the smiles, the term structure, prices in the browser. */
import { loadJSON, showError, fmtPct, fmtNum, el, renderStats, renderTable, signed, tok, alpha, slotColors, buildLegend } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";
import { draw, applyChartDefaults } from "./charts.js";
import { bs } from "./bs.js";

const POLL_MS = 60_000;
let D = null, lastAsOf = null, angle = 0.55, tilt = 0.62, selExp = null;

const pct = (x, dp = 1) => (x == null ? "—" : fmtPct(x, dp));
const pts = (x, dp = 1) => (x == null ? "—" : `${signed(x * 100, dp)} pts`);

/* ---------------- header + strip ---------------- */
function header() {
  const age = D.snapshot_age_min, when = D.as_of.replace("T", " ").slice(0, 16);
  const src = D.source === "questrade" ? (D.delayed_min ? `Questrade, ${D.delayed_min} min delayed` : "Questrade, real-time") : `yfinance, ${D.delayed_min} min delayed`;
  document.getElementById("vs-meta").textContent =
    `${D.underlying} ${fmtNum(D.spot, 2)} · snapshot ${when} (${src}) · ${D.n_ok.toLocaleString()} of ${D.n_quotes.toLocaleString()} quotes usable across ${D.expiries.length} expiries · r ${pct(D.r, 2)} q ${pct(D.q, 1)}`;
  const s = D.summary, c = D.cone || {};
  renderStats("vs-strip", [
    { label: "ATM IV 30d", value: pct(s.atm_iv_30), delta: `60d ${pct(s.atm_iv_60)}` },
    { label: "25Δ skew, 30d", value: pts(s.skew_25d_30), delta: "put IV − call IV" },
    { label: "Term 30/90", value: fmtNum(s.term_ratio_30_90, 2), delta: s.term_ratio_30_90 > 1 ? "inverted" : "contango", tone: s.term_ratio_30_90 > 1 ? "down" : "" },
    { label: "IV rank, 1y", value: fmtNum(c.iv_rank_1y, 2), delta: `percentile ${fmtNum(c.iv_pct_1y, 2)} · ${c.rank_source === "vix_proxy" ? "on VIX, 36 years" : "on snapshots"}` },
    { label: "IV − realised 21d", value: pts(c.iv_minus_rv21), delta: `realised 21d ${pct((c.realised || {}).rv_21)}`, tone: (c.iv_minus_rv21 || 0) > 0 ? "up" : "down" },
    { label: "Snapshot age", value: age < 60 ? `${Math.round(age)} min` : `${(age / 60).toFixed(1)} h`, delta: document.hidden ? "paused" : "polling every minute" },
  ]);
}

/* ---------------- 3-D surface ---------------- */
function surface3d() {
  const cv = document.getElementById("vs-3d");
  const ctx = cv && cv.getContext && cv.getContext("2d");
  if (!ctx || typeof ctx.scale !== "function") return;      // no real canvas (headless check): nothing to draw
  const W = cv.clientWidth || 800, H = 420, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = `${H}px`;
  ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
  const exps = D.expiries.filter((e) => e.grid.some((g) => g != null));
  const M = D.moneyness, nx = M.length, ny = exps.length;
  if (!ny) return;
  let lo = Infinity, hi = -Infinity;
  for (const e of exps) for (const g of e.grid) if (g != null) { lo = Math.min(lo, g); hi = Math.max(hi, g); }
  const zs = (v) => (v - lo) / (hi - lo || 1);
  const ca = Math.cos(angle), sa = Math.sin(angle), ct = Math.cos(tilt), st = Math.sin(tilt);
  const scale = Math.min(W, 640) * 0.42, cx = W / 2, cy = H * 0.58;
  const proj = (i, j, z) => {
    const x = (i / (nx - 1) - 0.5) * 1.6, y = (j / Math.max(ny - 1, 1) - 0.5) * 1.2, zz = z * 0.8 - 0.35;
    const xr = x * ca - y * sa, yr = x * sa + y * ca;
    return { x: cx + xr * scale, y: cy + (yr * st - zz * ct) * scale, depth: yr * ct + zz * st };
  };
  const ink = tok("--ink"), muted = tok("--muted"), grid = tok("--grid");
  const col = (t) => `hsl(${Math.round(215 - 215 * t)}, 70%, ${Math.round(46 + 14 * t)}%)`;
  const quads = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = exps[j].grid[i], b = exps[j].grid[i + 1], c = exps[j + 1].grid[i + 1], d = exps[j + 1].grid[i];
    if ([a, b, c, d].some((v) => v == null)) continue;
    const P = [proj(i, j, zs(a)), proj(i + 1, j, zs(b)), proj(i + 1, j + 1, zs(c)), proj(i, j + 1, zs(d))];
    quads.push({ P, depth: (P[0].depth + P[2].depth) / 2, v: (a + b + c + d) / 4 });
  }
  quads.sort((p, q) => p.depth - q.depth);
  // floor and axes
  ctx.strokeStyle = grid; ctx.lineWidth = 1;
  const corner = [proj(0, 0, 0), proj(nx - 1, 0, 0), proj(nx - 1, ny - 1, 0), proj(0, ny - 1, 0)];
  ctx.beginPath(); corner.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
  for (const q of quads) {
    ctx.fillStyle = col(zs(q.v)); ctx.strokeStyle = alpha("--surface", 0.55); ctx.lineWidth = 0.6;
    ctx.beginPath(); q.P.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // labels
  ctx.fillStyle = muted; ctx.font = `10px ${tok("--font-num") || "monospace"}`; ctx.textAlign = "center";
  for (let i = 0; i < nx; i += 5) { const p = proj(i, 0, 0); ctx.fillText(M[i].toFixed(2), p.x, p.y + 14); }
  ctx.textAlign = "left";
  const step = Math.max(1, Math.round(ny / 6));
  for (let j = 0; j < ny; j += step) { const p = proj(nx - 1, j, 0); ctx.fillText(`${exps[j].dte}d`, p.x + 6, p.y + 4); }
  ctx.fillStyle = ink; ctx.textAlign = "center";
  const pm = proj((nx - 1) / 2, 0, 0); ctx.fillText("strike / spot", pm.x, pm.y + 28);
  ctx.textAlign = "left"; const pz = proj(0, ny - 1, 1); ctx.fillText(`IV ${pct(lo, 0)} → ${pct(hi, 0)}`, 12, 18);
  // colour bar
  for (let k = 0; k < 60; k++) { ctx.fillStyle = col(k / 59); ctx.fillRect(12 + k * 2, 24, 2, 8); }
  ctx.fillStyle = muted; ctx.fillText(pct(lo, 0), 12, 44); ctx.fillText(pct(hi, 0), 100, 44);
}

function wire3d() {
  const cv = document.getElementById("vs-3d");
  let drag = null;
  const start = (x, y) => { drag = { x, y, a: angle, t: tilt }; };
  const move = (x, y) => { if (!drag) return; angle = drag.a + (x - drag.x) * 0.01; tilt = Math.max(0.15, Math.min(1.4, drag.t + (y - drag.y) * 0.01)); surface3d(); };
  cv.addEventListener("mousedown", (e) => start(e.clientX, e.clientY));
  window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
  window.addEventListener("mouseup", () => (drag = null));
  cv.addEventListener("touchstart", (e) => start(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  cv.addEventListener("touchmove", (e) => move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  cv.addEventListener("touchend", () => (drag = null));
  window.addEventListener("resize", surface3d);
}

/* ---------------- smiles + term ---------------- */
function pickExpiries() {
  const es = D.expiries.filter((e) => e.n_ok >= 40);
  const want = [7, 14, 30, 60, 90, 180];
  const out = [];
  for (const w of want) { const e = es.reduce((b, x) => (Math.abs(x.dte - w) < Math.abs(b.dte - w) ? x : b), es[0]); if (e && !out.includes(e)) out.push(e); }
  return out;
}

function numericLine(id, labels, series, xFmt, yFmt, extra = {}) {
  draw(id, {
    type: "line",
    data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, borderColor: s.color, borderWidth: s.width ?? 2, borderDash: s.dash,
      pointRadius: s.points ? 2.5 : 0, pointBackgroundColor: s.color, pointHoverRadius: 4, tension: 0.25, spanGaps: true })) },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      scales: { x: { grid: { display: false }, border: { color: tok("--baseline") }, ticks: { maxTicksLimit: 9, callback: (v) => xFmt(labels[v]) } },
                y: { grid: { color: tok("--grid") }, border: { display: false }, ticks: { callback: yFmt } } },
      plugins: { tooltip: { callbacks: { title: (it) => xFmt(labels[it[0].dataIndex]), label: (c) => ` ${c.dataset.label}: ${yFmt(c.parsed.y)}` } } }, ...extra },
  });
}

function smiles() {
  const es = pickExpiries(), colors = slotColors(es.length);
  numericLine("vs-smile", D.moneyness, es.map((e, i) => ({ label: `${e.expiry} · ${e.dte}d`, data: e.grid, color: colors[i] })),
    (m) => Number(m).toFixed(2), (v) => pct(v, 0));
  buildLegend("vs-smile-legend", es.map((e, i) => ({ label: `${e.dte}d`, color: colors[i], shape: "line" })));
}

function term() {
  const es = D.expiries.filter((e) => e.atm_iv != null);
  const c = slotColors(3);
  numericLine("vs-term", es.map((e) => e.dte), [
    { label: "ATM", data: es.map((e) => e.atm_iv), color: c[0], points: true },
    { label: "25Δ put", data: es.map((e) => e.iv_25p ?? null), color: c[1], dash: [4, 3] },
    { label: "25Δ call", data: es.map((e) => e.iv_25c ?? null), color: c[2], dash: [4, 3] },
  ], (d) => `${d}d`, (v) => pct(v, 0));
  buildLegend("vs-term-legend", [{ label: "ATM", color: c[0], shape: "line" }, { label: "25Δ put", color: c[1], shape: "line" }, { label: "25Δ call", color: c[2], shape: "line" }]);
}

/* ---------------- surface lookup for the pricer ---------------- */
function surfaceIV(K, days) {
  const m = K / D.spot, M = D.moneyness;
  const rowIV = (e) => {
    if (m < M[0] || m > M[M.length - 1]) return null;
    let i = 0; while (i < M.length - 2 && M[i + 1] < m) i++;
    const a = e.grid[i], b = e.grid[i + 1];
    if (a == null || b == null) return null;
    return a + (b - a) * (m - M[i]) / (M[i + 1] - M[i]);
  };
  const es = D.expiries.map((e) => ({ dte: e.dte, iv: rowIV(e) })).filter((x) => x.iv != null);
  if (!es.length) return null;
  const below = es.filter((x) => x.dte <= days).pop(), above = es.find((x) => x.dte >= days);
  if (!below) return above.iv; if (!above) return below.iv; if (below.dte === above.dte) return below.iv;
  const tv = below.iv ** 2 * below.dte + (above.iv ** 2 * above.dte - below.iv ** 2 * below.dte) * (days - below.dte) / (above.dte - below.dte);
  return Math.sqrt(Math.max(tv, 0) / days);
}

/* ---------------- pricer ---------------- */
function pricer() {
  const host = document.getElementById("vs-pricer"); host.innerHTML = "";
  const atmK = Math.round(D.spot);
  const fields = [["S", "Spot", D.spot.toFixed(2)], ["K", "Strike", atmK], ["days", "Days", 30], ["sigma", "IV %", (D.summary.atm_iv_30 * 100).toFixed(2)],
                  ["r", "Rate %", (D.r * 100).toFixed(2)], ["q", "Div yield %", (D.q * 100).toFixed(2)]];
  const inputs = {};
  for (const [id, label, val] of fields) {
    inputs[id] = el("input", { id: `pr-${id}`, type: "number", step: "any", value: String(val), inputmode: "decimal" });
    host.appendChild(el("label", { class: "field" }, [el("span", { text: label }), inputs[id]]));
  }
  const right = el("div", { class: "seg", role: "group" }, [el("button", { type: "button", "data-r": "C", class: "active", text: "Call" }), el("button", { type: "button", "data-r": "P", text: "Put" })]);
  const useSurf = el("button", { type: "button", class: "pill", text: "IV from surface" });
  host.appendChild(el("label", { class: "field" }, [el("span", { text: "Right" }), right]));
  host.appendChild(el("label", { class: "field" }, [el("span", { text: " " }), useSurf]));
  let r = "C";
  const out = document.getElementById("vs-pricer-out");
  const paint = () => {
    const S = +inputs.S.value, K = +inputs.K.value, T = +inputs.days.value / 365, sig = +inputs.sigma.value / 100, rr = +inputs.r.value / 100, qq = +inputs.q.value / 100;
    const g = bs(S, K, T, sig, r, rr, qq);
    const sIV = surfaceIV(K, +inputs.days.value);
    const mkt = sIV != null ? bs(S, K, T, sIV, r, rr, qq).price : null;
    renderStats(out, [
      { label: "Price", value: fmtNum(g.price, 3), delta: sIV != null ? `at surface IV ${pct(sIV, 2)}: ${fmtNum(mkt, 3)}` : "outside the quoted surface" },
      { label: "Delta", value: fmtNum(g.delta, 4), delta: `${fmtNum(g.delta * 100, 1)} shares per contract` },
      { label: "Gamma", value: fmtNum(g.gamma, 5), delta: "per $1 of spot" },
      { label: "Vega", value: fmtNum(g.vega, 4), delta: "per vol point" },
      { label: "Theta", value: fmtNum(g.theta, 4), delta: "per calendar day", tone: "down" },
      { label: "Rho", value: fmtNum(g.rho, 4), delta: "per 1% of rate" },
    ]);
  };
  for (const i of Object.values(inputs)) i.addEventListener("input", paint);
  right.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { r = b.dataset.r; right.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b)); paint(); }));
  useSurf.addEventListener("click", () => { const v = surfaceIV(+inputs.K.value, +inputs.days.value); if (v != null) { inputs.sigma.value = (v * 100).toFixed(2); paint(); } });
  paint();
}

/* ---------------- models ---------------- */
function models() {
  const m = (D.models || {}).models || {}; const host = document.getElementById("vs-models-note");
  if (!Object.keys(m).length) { host.textContent = (D.models || {}).note || "no calibration"; return; }
  host.textContent = `${D.models.n_fit} quotes to fit, ${D.models.n_test} held out · ${D.models.method}`;
  const rows = Object.entries(m).map(([k, v]) => ({ model: v.label, np: v.n_params, out: v.rmse_out, inn: v.rmse_in,
    front: (v.by_tenor || {}).front, mid: (v.by_tenor || {}).mid, back: (v.by_tenor || {}).back,
    pw: (v.by_wing || {}).put_wing, atm: (v.by_wing || {}).atm, cw: (v.by_wing || {}).call_wing,
    params: Object.entries(v.params).map(([a, b]) => `${a} ${Number(b).toFixed(3)}`).join(" · ") + (k === "heston" ? ` · Feller ${v.feller ? "holds" : "violated"}` : ""),
    secs: v.seconds }));
  const f = (v) => (v == null ? "—" : fmtNum(v, 2));
  renderTable(document.getElementById("vs-models"), rows, [
    { key: "model", label: "Model" }, { key: "np", label: "Params", num: true },
    { key: "out", label: "RMSE held-out", num: true, cls: (r) => (r.out === Math.min(...rows.map((x) => x.out)) ? "up" : ""), fmt: f },
    { key: "inn", label: "RMSE fit", num: true, fmt: f },
    { key: "front", label: "< 30d", num: true, fmt: f }, { key: "mid", label: "30–90d", num: true, fmt: f }, { key: "back", label: "> 90d", num: true, fmt: f },
    { key: "pw", label: "Put wing", num: true, fmt: f }, { key: "atm", label: "±5%", num: true, fmt: f }, { key: "cw", label: "Call wing", num: true, fmt: f },
    { key: "params", label: "Calibrated parameters" },
  ]);
}

/* ---------------- chain ---------------- */
function chain() {
  const sel = document.getElementById("vs-exp");
  const nearest30 = (D.expiries.reduce((b, x) => (Math.abs(x.dte - 30) < Math.abs(b.dte - 30) ? x : b), D.expiries[0]) || {}).expiry;
  if (!sel.querySelectorAll("option").length || sel.getAttribute("data-asof") !== D.as_of) {
    const cur = sel.value; sel.innerHTML = "";
    for (const e of D.expiries) sel.appendChild(el("option", { value: e.expiry, text: `${e.expiry} · ${e.dte}d · ${e.n_ok} quotes` }));
    sel.setAttribute("data-asof", D.as_of);
    sel.value = D.expiries.some((e) => e.expiry === cur) ? cur : nearest30;
    sel.onchange = chain;
  }
  const e = D.expiries.find((x) => x.expiry === sel.value) || D.expiries.find((x) => x.expiry === nearest30); if (!e) return;
  const hasM = e.points.some((p) => p.px_heston != null);
  document.getElementById("vs-chain-note").textContent = `${e.expiry} · ${e.dte} days · ATM ${pct(e.atm_iv)} · 25Δ skew ${pts(e.skew_25)} · OTM quotes the cross-check passed`;
  const cols = [
    { key: "strike", label: "Strike", num: true, fmt: (v) => fmtNum(v, 0) },
    { key: "right", label: "", fmt: (v) => el("span", { class: `pill ${v === "P" ? "warn" : ""}`, text: v === "P" ? "put" : "call" }) },
    { key: "bid", label: "Bid", num: true, fmt: (v) => fmtNum(v, 2) }, { key: "ask", label: "Ask", num: true, fmt: (v) => fmtNum(v, 2) },
    { key: "iv", label: "IV", num: true, fmt: (v) => pct(v, 2) }, { key: "delta", label: "Δ", num: true, fmt: (v) => signed(v, 2) },
    { key: "gamma", label: "Γ", num: true, fmt: (v) => fmtNum(v, 4) }, { key: "vega", label: "Vega", num: true, fmt: (v) => fmtNum(v, 2) },
    { key: "theta", label: "Θ/day", num: true, fmt: (v) => fmtNum(v, 3) },
    { key: "oi", label: "OI", num: true, fmt: (v) => v.toLocaleString() }, { key: "vol", label: "Volume", num: true, fmt: (v) => v.toLocaleString() },
  ];
  if (hasM) cols.push({ key: "px_heston", label: "Heston", num: true, cls: (r) => (r.px_heston != null && r.mid ? (Math.abs(r.px_heston - r.mid) / r.mid > 0.15 ? "down" : "") : ""), fmt: (v, r) => (v == null ? "—" : `${fmtNum(v, 2)}`) },
                       { key: "px_merton", label: "Merton", num: true, fmt: (v) => (v == null ? "—" : fmtNum(v, 2)) });
  renderTable(document.getElementById("vs-chain"), e.points, cols, { sortKey: "strike", dir: 1 });
}

/* ---------------- lifecycle ---------------- */
function paint() {
  setAsOf(D.as_of.slice(0, 10));
  header(); surface3d(); smiles(); term(); models(); chain();
  document.getElementById("vs-note").textContent = D.note + (Object.keys(D.flags || {}).length ? ` Flags in this snapshot: ${Object.entries(D.flags).map(([k, v]) => `${k} ${v}`).join(", ")}.` : "");
}

async function poll() {
  if (document.hidden) return;
  try {
    const d = await loadJSON(`data/vol_surface.json?t=${Date.now()}`);
    if (d.as_of !== lastAsOf) { D = d; lastAsOf = d.as_of; paint(); }
    else { document.querySelector("#vs-strip .stat:last-child .stat-v").textContent = D.snapshot_age_min < 60 ? `${Math.round(D.snapshot_age_min + (Date.now() - t0) / 60000)} min` : `${((D.snapshot_age_min + (Date.now() - t0) / 60000) / 60).toFixed(1)} h`; }
  } catch (e) { /* keep the last good surface */ }
}
let t0 = Date.now();

async function init() {
  renderShell(); applyChartDefaults();
  try {
    D = await loadJSON("data/vol_surface.json"); lastAsOf = D.as_of; t0 = Date.now();
    pricer(); wire3d(); paint();
    setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
    window.addEventListener("themechange", () => { applyChartDefaults(); paint(); });
  } catch (err) { showError(document.getElementById("error"), err); throw err; }
}
init();
