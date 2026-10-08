/* Renaissance Technologies' 13F record and what it lines up with
   (rentech/analysis.py -> data/rentech.json). */

import { loadJSON, showError, el, fmtPct, fmtDate, renderStats, renderTable, tok, breakdownColors } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { draw, lineConfig, applyChartDefaults } from "./charts.js";

const $ = (id) => document.getElementById(id);
let D = null, bMode = "value", fmMode = "trade.d_weight", lMode = "top";

const bn = (x) => (x == null ? "–" : x >= 1e9 ? `US$${(x / 1e9).toFixed(1)}bn` : `US$${(x / 1e6).toFixed(0)}m`);
const tcell = (t) => el("span", { class: t == null ? "note" : Math.abs(t) >= 3 ? (t > 0 ? "up" : "down") : Math.abs(t) >= 2 ? "" : "note",
  text: t == null ? "–" : t.toFixed(1) });
const r1 = (x, dp = 1) => (x == null ? "–" : x.toFixed(dp));

function strip() {
  const S = D.sample, B = D.book, last = B.series[B.series.length - 1], dur = B.duration;
  renderStats("rt-strip", [
    { label: "Filings read", value: String(D.coverage.length), delta: `${D.coverage[0].date.slice(0, 4)} to ${last.date}` },
    { label: "Book, latest", value: bn(last.value), delta: `${last.names.toLocaleString()} positions` },
    { label: "Turnover a quarter", value: fmtPct(last.turnover, 0), delta: "of the book's weight changes hands" },
    { label: "A position lasts", value: `${dur.median_quarters.toFixed(0)} quarters`, delta: `median · ${fmtPct(dur.share_one_quarter, 0)} gone after one` },
    { label: "Tested", value: `${S.quarters} quarters`, delta: `${S.company_quarters.toLocaleString()} company-quarters, ${S.first.slice(0, 4)} on` },
  ]);
  $("rt-caveat").textContent = "A 13F is a photograph of the long book on the last day of the quarter, published up to 45 days later. " +
    "It has no short positions, no futures, no options beyond listed puts and calls, and nothing about what was bought and sold in between. " +
    "Renaissance's Medallion fund turns its book over in days, so almost none of its trading is visible here; what the filing mostly shows is " +
    "the slower institutional funds (RIEF and its siblings) and whatever Medallion happened to hold at the close. Everything below measures " +
    "what the photographs line up with. None of it is the firm's model, and a trait that lines up with their holdings is not a trait that " +
    "earns money — the last section tests that separately.";
}

function bookChart() {
  const S = D.book.series;
  const fmt = { value: (v) => bn(v), names: (v) => v.toLocaleString(), turnover: (v) => fmtPct(v, 0), top10: (v) => fmtPct(v, 0),
    median_age_quarters: (v) => `${v.toFixed(1)} q` }[bMode];
  const cfg = lineConfig({ labels: S.map((p) => p.date), yFmt: fmt, series: [
    { label: { value: "Long equity book", names: "Positions", turnover: "Turnover a quarter", top10: "Top-10 weight", median_age_quarters: "Median position age (quarters)" }[bMode],
      data: S.map((p) => p[bMode]), color: tok("--accent"), width: 2, fill: true },
  ] });
  cfg.options.plugins.legend = { display: false };
  draw("rt-b-chart", cfg);
  const a = S[0], z = S[S.length - 1];
  $("rt-b-meta").textContent = `${fmtDate(a.date)} to ${fmtDate(z.date)}`;
  $("rt-b-note").textContent = `Turnover is half the sum of absolute weight changes between consecutive filings: ${fmtPct(S.reduce((s, p) => s + (p.turnover || 0), 0) / S.filter((p) => p.turnover != null).length, 0)} a quarter on average. ` +
    `The median position has been held ${z.median_age_quarters.toFixed(0)} consecutive quarters; ${fmtPct(D.book.duration.share_over_two_years, 0)} of all holding spells lasted two years or more.`;
}

const FM_WHAT = {
  "trade.d_weight": "The change in a name's weight since the prior filing (basis points of the book) on its traits at the quarter end, every company in the panel. A positive coefficient means the firm moved towards that trait that quarter.",
  "trade.new_vs_not": "Among names not held at the prior filing: did the firm open a position (1) or not (0)? Coefficients are the change in that probability per standard deviation of the trait.",
  "trade.exit_vs_kept": "Among names held at the prior filing: was the position dropped entirely (1) or kept (0)?",
  "trade.d_shares_kept": "Among names held at both filings: the percentage change in shares (capped at +300%).",
  "level.held": "Is the name in the book at all (1) or not (0)? This is the shape of the book, not the trade.",
  "level.weight": "Among names held: the weight in basis points. Liquidity dominates here, as it must for a book this size.",
};

function fm() {
  const [a, b] = fmMode.split("."), tab = D[a][b];
  const rows = Object.entries(tab).map(([k, v]) => ({ key: k, ...v })).sort((x, y) => Math.abs(y.t || 0) - Math.abs(x.t || 0));
  const cols = [
    { key: "label", label: "Trait" },
    { key: "mean", label: "Coefficient", num: true, fmt: (v) => (v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(3)) },
    { key: "t", label: "t", num: true, fmt: (v) => tcell(v) },
    { key: "share_positive", label: "Quarters positive", num: true, fmt: (v) => fmtPct(v, 0) },
    ...D.eras.map((e) => ({ key: `era_${e}`, label: `t ${e}`, num: true, fmt: (_, r) => tcell(r.eras?.[e]?.t) })),
  ];
  renderTable($("rt-fm"), rows, cols);
  $("rt-fm-what").textContent = FM_WHAT[fmMode];
  const sig = rows.filter((r) => Math.abs(r.t || 0) >= 3);
  $("rt-fm-note").textContent = `${rows[0].quarters} quarterly cross-sections. Traits are winsorised at 1% and 99% and standardised within the quarter, so a coefficient is per standard deviation. ` +
    `|t| ≥ 3 is the bar this site uses everywhere (${sig.length} of ${rows.length} clear it here); the era columns show whether the tilt held throughout or came and went.`;
}

function fund() {
  const F = D.fundamentals || {};
  if (!F.d_weight) { $("rt-fund-note").textContent = "Not available."; return; }
  const keys = Object.keys(F.d_weight);
  const rows = keys.map((k) => ({ label: F.d_weight[k].label, held_t: F.held?.[k]?.t, dw_t: F.d_weight[k].t, new_t: F.new_vs_not?.[k]?.t }));
  renderTable($("rt-fund"), rows, [
    { key: "label", label: "Trait" },
    { key: "held_t", label: "Held, t", num: true, fmt: (v) => tcell(v) },
    { key: "dw_t", label: "Weight change, t", num: true, fmt: (v) => tcell(v) },
    { key: "new_t", label: "New position, t", num: true, fmt: (v) => tcell(v) },
  ]);
  $("rt-fund-note").textContent = `Earnings surprise, value, profitability, accruals, asset growth, share issuance and size exist only for the ` +
    `small-cap half of the panel (${D.sample.fundamentals_rows.toLocaleString()} company-quarters), so this is the small-cap book only.`;
}

function fwd() {
  const F = D.forward;
  const H = [["fwd_1m", "1 month from quarter end"], ["fwd_3m", "3 months from quarter end"], ["fwd_file_1m", "1 month from the filing"], ["fwd_file_3m", "3 months from the filing"]];
  const groups = [["new", "New positions"], ["top_decile_adds", "Largest adds (top decile)"], ["kept", "All kept"], ["bottom_decile_cuts", "Largest cuts (bottom decile)"], ["exited", "Dropped"], ["book_vw", "Whole book, value-weighted"]];
  const rows = groups.map(([g, label]) => {
    const r = { label };
    H.forEach(([h]) => { const s = F[h]?.summary?.[g]; r[`${h}_m`] = s?.excess_mean; r[`${h}_t`] = s?.excess_t; });
    return r;
  });
  renderTable($("rt-fwd"), rows, [
    { key: "label", label: "Names" },
    ...H.map(([h, label]) => ({ key: `${h}_m`, label, num: true, fmt: (v, r) => el("span", {}, [
      el("span", { text: v == null ? "–" : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%" }), el("span", { class: "note", text: " t " }), tcell(r[`${h}_t`])]) })),
  ]);
  const q = F.fwd_3m?.summary?.new?.quarters;
  $("rt-fwd-note").textContent = `Equal-weight mean return of each group less the mean of every company in the panel that quarter, winsorised at 1% and 99%, ` +
    `averaged over ${q || "–"} quarters with a Newey-West t. "From the filing" starts at the first close after the 13F became public: what a copier could have earned.`;
}

function tilts() {
  const T = D.tilts, keys = ["mom_12_1", "ret_1m", "vol_60", "dvol", "beta", "pth"];
  const cols = breakdownColors(keys.length);
  const cfg = lineConfig({ labels: T.map((p) => p.date), yFmt: (v) => v.toFixed(1), series: keys.map((k, i) => ({
    label: D.labels[k], data: T.map((p) => p[k]), color: cols[i], width: 1.5 })) });
  cfg.options.plugins.legend = { display: false };
  draw("rt-t-chart", cfg);
  const lg = $("rt-t-legend"); lg.innerHTML = "";
  keys.forEach((k, i) => lg.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-line", style: `border-top-color:${cols[i]}` }), el("span", { text: D.labels[k] })])));
}

function latest() {
  const L = D.latest;
  $("rt-l-meta").textContent = `report date ${fmtDate(L.report_date)}`;
  if (lMode === "top") {
    renderTable($("rt-l"), L.top, [
      { key: "symbol", label: "Ticker", fmt: (v) => el("span", { class: "sym", text: v || "" }) },
      { key: "issuer", label: "Issuer", cls: () => "note" },
      { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v, 2) },
      { key: "value", label: "Value", num: true, fmt: bn },
      { key: "shares", label: "Shares", num: true, fmt: (v) => Math.round(v).toLocaleString() },
    ]);
  } else {
    renderTable($("rt-l"), L[lMode], [
      { key: "symbol", label: "Ticker", fmt: (v) => el("span", { class: "sym", text: v || "" }) },
      { key: "issuer", label: "Issuer", cls: () => "note" },
      { key: "event", label: "What", cls: () => "note" },
      { key: "weight_prev", label: "Weight before", num: true, fmt: (v) => fmtPct(v, 2) },
      { key: "weight", label: "Weight now", num: true, fmt: (v) => fmtPct(v, 2) },
      { key: "d_weight", label: "Change", num: true, fmt: (v) => el("span", { class: v > 0 ? "up" : "down", text: (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + " pts" }) },
      { key: "shares", label: "Shares now", num: true, fmt: (v) => Math.round(v).toLocaleString() },
    ]);
  }
}

function wire() {
  // The shell syncs aria-pressed from .active after any click inside a .seg.
  const seg = (id, set) => $(id).querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b)); set(b.dataset.k); }));
  seg("rt-b-mode", (k) => { bMode = k; bookChart(); });
  seg("rt-fm-mode", (k) => { fmMode = k; fm(); });
  seg("rt-l-mode", (k) => { lMode = k; latest(); });
}

(async function init() {
  renderShell();
  try { D = await loadJSON("data/rentech.json"); } catch (err) { showError($("error"), err); return; }
  setAsOf(D.as_of, "AS OF", { note: `latest filing ${D.latest.report_date}` });
  strip(); bookChart(); fm(); fund(); fwd(); tilts(); latest(); wire();
  $("rt-method").textContent = D.method;
  onThemeChange(() => { applyChartDefaults(); bookChart(); tilts(); });
})();
