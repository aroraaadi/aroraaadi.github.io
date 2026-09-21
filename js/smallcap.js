/* The small-cap screen: five pillars, scored, over the whole investable band.

   The composite is a weighted average of five 0–1 pillar scores and the page
   shows every pillar beside it, because a rank you cannot decompose is a rank
   you cannot argue with. Sorting is on any column. */

import {
  loadJSON, showError, fmtPct, fmtNum, el, renderStats, renderTable, signClass, breakdownColors,
} from "./common.js";
import { applyChartDefaults, draw, describeCanvas } from "./charts.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";

let D = null;

const PILLARS = [
  ["pure_play", "Pure play", "Gross margin, and whether thematic ETFs treat it as a pure play on something."],
  ["room", "Room to grow", "Revenue compounding off a base small enough for the rate to mean something."],
  ["undiscovered", "Undiscovered", "Analyst coverage count — a proxy for institutional attention, which is a premium field here."],
  ["growth_value", "Growth + value", "Growth priced sanely, and a balance sheet with cash and little debt."],
  ["resilience", "Survives a fall", "Beta, Altman Z and Piotroski: can it be held through a 25–30% stop without being stopped out on noise."],
];

const bar = (v) => {
  const wrap = el("span", { class: "meter", style: "width:46px;display:inline-block;vertical-align:middle" });
  if (v != null) wrap.appendChild(el("i", { style: `width:${(v * 100).toFixed(0)}%` }));
  return el("span", { style: "display:inline-flex;align-items:center;gap:6px;white-space:nowrap" }, [
    el("span", { class: "num", text: v == null ? "—" : v.toFixed(2) }),
    wrap,
  ]);
};

function renderHeadline() {
  const rows = D.rows;
  const top = rows[0];
  const netCash = rows.filter((r) => (r.net_debt ?? 1) < 0).length;
  const thin = rows.filter((r) => (r.analysts ?? 99) <= 6).length;
  renderStats("headline", [
    { label: "Scored", value: String(rows.length),
      delta: `from ${(D.n_excluded || 0) + rows.length} in the band` },
    { label: "Market-cap band", value: `$${(D.band[0] / 1e6).toFixed(0)}m–$${(D.band[1] / 1e9).toFixed(1)}bn`,
      delta: "US-listed, $3+, 100k shares/day" },
    top ? { label: "Top score", value: fmtNum(top.composite, 2),
            delta: `${top.symbol} · ${top.name?.slice(0, 22) || ""}` } : null,
    { label: "Net cash", value: String(netCash), delta: "of the scored names carry no net debt" },
    { label: "Thinly covered", value: String(thin), delta: "six analysts or fewer" },
    { label: "Excluded", value: String(D.n_excluded || 0),
      delta: (D.excluded_sectors || []).join(" + ") + " — leverage is the business" },
  ]);
}

function renderPillars() {
  const host = document.getElementById("pillars"); host.innerHTML = "";
  for (const [key, label, why] of PILLARS) {
    const w = D.weights?.[key];
    const vals = D.rows.map((r) => r.pillars?.[key]).filter((v) => v != null);
    const med = vals.length ? vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)] : null;
    host.appendChild(el("div", { class: "alloc-row", style: "grid-template-columns:130px 52px 1fr" }, [
      el("span", { class: "sym", text: label }),
      el("span", { class: "num", text: w == null ? "—" : fmtPct(w, 0) }),
      el("span", { class: "note", text: `${why}${med != null ? `  Median score ${med.toFixed(2)}.` : ""}` }),
    ]));
  }
}

function table(rows, id) {
  renderTable(document.getElementById(id), rows, [
    { key: "symbol", label: "Symbol", fmt: (v, r) => el("span", {}, [
        el("span", { class: "sym", text: v }),
        el("span", { class: "note", style: "display:block", text: (r.name || "").slice(0, 30) })]) },
    { key: "composite", label: "Score", num: true,
      fmt: (v) => el("b", { class: "num", text: v == null ? "—" : v.toFixed(2) }) },
    ...PILLARS.map(([k, label]) => ({
      key: `p_${k}`, label, num: true, fmt: (v) => bar(v),
    })),
    { key: "market_cap", label: "Mkt cap", num: true,
      fmt: (v) => (v == null ? "—" : `$${(v / 1e6).toFixed(0)}m`) },
    { key: "rev_cagr_3y", label: "Rev 3y", num: true, cls: (r) => signClass(r.rev_cagr_3y),
      fmt: (v) => (v == null ? "—" : fmtPct(v, 0)) },
    // Net debt over REVENUE, not over EBITDA: defined for every operating
    // company including one having a bad year, and it cannot flip sign for
    // the wrong reason.
    { key: "nd_rev", label: "Net debt / rev", num: true,
      cls: (r) => ((r.nd_rev ?? 0) < 0 ? "pos" : (r.nd_rev ?? 0) > 1 ? "neg" : ""),
      fmt: (v) => (v == null ? "—" : `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(2)}x`) },
    { key: "analysts", label: "Analysts", num: true,
      fmt: (v) => (v == null ? "—" : String(Math.round(v))) },
    { key: "sector", label: "Sector" },
    { key: "why", label: "Why it scores", cls: () => "wrap",
      fmt: (v) => el("span", { class: "note", text: v || "—" }) },
  ], { sortKey: "composite", dir: -1 });
}

/* Score against market cap: the screen is supposed to find quality that is
   small, so the interesting names are top-left. */
function renderScatter() {
  const rows = D.rows.filter((r) => r.composite != null && r.market_cap);
  const colors = breakdownColors(8);
  const sectors = [...new Set(rows.map((r) => r.sector))];
  draw("sc-chart", {
    type: "scatter",
    data: { datasets: sectors.map((s, i) => ({
      label: s,
      data: rows.filter((r) => r.sector === s).map((r) => ({
        x: r.market_cap / 1e6, y: r.composite, sym: r.symbol })),
      backgroundColor: colors[i % colors.length], pointRadius: 4, pointHoverRadius: 7,
    })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { type: "logarithmic", title: { display: true, text: "market cap ($m)" },
             ticks: { callback: (v) => (String(v).match(/^[123456789]0*$/) ? `${v}` : "") } },
        y: { title: { display: true, text: "composite score" }, min: 0, max: 1 },
      },
      plugins: { tooltip: { callbacks: {
        label: (c) => ` ${c.raw.sym}: ${c.parsed.y.toFixed(2)} at $${c.parsed.x.toFixed(0)}m` } } },
    },
  });
  describeCanvas("sc-chart", `Composite score against market capitalisation for ${rows.length} names.`);
}

function prep() {
  for (const r of D.rows) {
    for (const [k] of PILLARS) r[`p_${k}`] = r.pillars?.[k] ?? null;
    r.nd_rev = (r.net_debt != null && r.revenue) ? r.net_debt / r.revenue : null;
    r.why = (r.reasons || []).join(" · ");
  }
}

function renderAll() {
  applyChartDefaults();
  renderHeadline(); renderPillars(); renderScatter();
  table(D.rows.slice(0, 20), "top-table");
  table(D.rows, "all-table");
  document.getElementById("all-note").textContent =
    `${D.rows.length} names scored on at least four of the five pillars. Sort any column.`;
}

(async function init() {
  renderShell();
  try { D = await loadJSON("data/smallcap.json"); }
  catch (err) { showError(document.getElementById("error"), err); return; }
  setAsOf(D.as_of);
  prep();
  renderAll();
  onThemeChange(renderAll);
})();
