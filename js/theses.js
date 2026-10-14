/* The Theses page (valuation/thesis_review.py --publish -> data/theses.json): every valued name's tests, the panel's
   arguments, the judged odds and the kill criteria. A row (or #SYMBOL in the address) opens its card. */

import { loadJSON, showError, el, fmtPct, fmtNum, fmtDate, renderStats, renderTable } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const $ = (id) => document.getElementById(id);
const pct = (x, dp = 0) => (x == null ? "–" : fmtPct(x, dp));
const odds = (p) => (p ? `${Math.round(p.bear * 100)} / ${Math.round(p.base * 100)} / ${Math.round(p.bull * 100)}` : "–");
const STATUS = { intact: "up", weakened: "", broken: "down" };
const SHOCK = { rates_up: "Rates +1pt", rates_down: "Rates −1pt", erp_up: "Risk premium +1pt", recession: "Recession", inflation: "Inflation +2pt" };

function statusCell(r) {
  if (!r.status) return el("span", { class: "note", text: "not reviewed" });
  return el("span", { class: STATUS[r.status] || "", text: r.status + (r.stale ? " (stale)" : "") });
}

function gateCell(r) {
  const g = r.gate;
  if (!g) return el("span", { class: "note", text: "–" });
  if (g.cap) return el("span", { class: "down", text: `capped ${pct(g.cap)}` });
  if (g.flag) return el("span", { class: "down", text: "flagged for owner" });
  return el("span", { class: "note", text: "watch" });
}

function rows(D) {
  return D.names.map((r) => {
    const ov = r.outside_view || {};
    const fails = (r.consistency || []).filter((c) => c.severity === "fail").length;
    const warns = (r.consistency || []).filter((c) => c.severity === "warn").length;
    const path = (r.drift || {}).path;
    return {
      ...r, book: r.in_book ? "held / target" : "",
      base_pct: (ov.base || {}).pct, needs_pct: (ov.price_needs || {}).pct, needs: (ov.price_needs || {}).cagr,
      checks: fails ? `${fails} fail` + (warns ? `, ${warns} warn` : "") : warns ? `${warns} warn` : "ok",
      drift_rev: path && path.judged ? path.revenue.score : null,
      dview: r.view != null && r.view_raw != null ? r.view - r.view_raw : null,
      gate_txt: !r.gate ? "" : r.gate.cap ? "capped" : r.gate.flag ? "flagged" : "watch",
    };
  });
}

function table(D) {
  const data = rows(D);
  renderTable($("th-tbl"), data, [
    { key: "symbol", label: "Name", fmt: (v) => el("a", { href: `#${v}`, text: v }) },
    { key: "book", label: "Book" },
    { key: "status", label: "Thesis", fmt: (_, r) => statusCell(r) },
    { key: "probs", label: "Bear / base / bull %", fmt: (v) => odds(v) },
    { key: "confidence", label: "Confidence", num: true, fmt: (v) => (v == null ? "–" : fmtNum(v, 2)) },
    { key: "view", label: "Expected return", num: true, fmt: (v) => pct(v, 1) },
    { key: "dview", label: "Judging moved it", num: true, fmt: (v) => (v == null || Math.abs(v) < 5e-5 ? "–" : `${v > 0 ? "+" : ""}${(v * 1e4).toFixed(0)} bp`) },
    { key: "base_pct", label: "Base case: peers that did it", num: true, fmt: (v) => pct(v, 0) },
    { key: "needs", label: "Price needs (5y growth)", num: true, fmt: (v) => pct(v, 0) },
    { key: "drift_rev", label: "Revenue drift", num: true, fmt: (v) => (v == null ? "–" : fmtNum(v, 1)) },
    { key: "checks", label: "Checks" },
    { key: "gate_txt", label: "Gate", fmt: (_, r) => gateCell(r) },
  ]);
  $("th-meta").textContent = `${data.filter((r) => r.review).length} reviewed of ${data.length}; odds in percent`;
  $("th-tbl").addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (a) { e.preventDefault(); history.replaceState(null, "", a.getAttribute("href")); card(D, a.textContent); }
  });
}

function factText(review, id) {
  const f = review && review.facts ? review.facts[id] : null;
  return f ? `${id}: ${f.label} = ${typeof f.value === "number" ? fmtNum(f.value, 4) : f.value}${f.unit ? " " + f.unit : ""}` : id;
}

function argList(review, args) {
  return el("ul", {}, (args || []).map((a) => el("li", {}, [
    el("span", { text: a.claim + " " }),
    el("span", { class: "note", title: (a.cites || []).map((c) => factText(review, c)).join("\n"), text: `[${(a.cites || []).join(", ")}]` }),
  ])));
}

function card(D, sym) {
  const r = D.names.find((x) => x.symbol === sym);
  const host = $("th-card");
  host.innerHTML = "";
  if (!r) return;
  const rv = r.review;
  const kids = [
    el("div", { class: "panel-h" }, [el("h2", { text: `${r.symbol} · ${r.name}` }), el("span", { class: "spacer" }),
      el("span", { class: "note", text: rv ? `reviewed ${fmtDate(rv.date)}${rv.cost_usd != null ? ` · $${rv.cost_usd.toFixed(2)}` : ""}` : "not reviewed yet" })]),
  ];
  const b = el("div", { class: "panel-b method" });
  b.appendChild(el("p", {}, [el("b", { text: "House thesis. " }), r.thesis || "–"]));
  b.appendChild(el("p", {}, [el("b", { text: "Odds (bear / base / bull). " }),
    `${odds(r.probs)}%` + (rv && rv.probs_raw ? `; the judge said ${odds(rv.probs_raw)}% before the bounds` : "") +
    `; confidence ${r.confidence == null ? "–" : fmtNum(r.confidence, 2)}. Expected return ${pct(r.view, 1)} against ${pct(r.view_raw, 1)} at 25 / 50 / 25.`]));
  if (rv && rv.judge && rv.judge.verdict) b.appendChild(el("p", {}, [el("b", { text: "Judge. " }), rv.judge.verdict]));
  const kill = (r.drift || {}).claims || [];
  if (kill.length) {
    b.appendChild(el("h3", { text: "Kill criteria and claims" }));
    b.appendChild(el("ul", {}, kill.map((c) => el("li", {}, [
      el("span", { text: `${c.kpi.replace("_", " ")} FY${c.fy} ${c.op} ${c.value} ` }),
      el("span", { class: c.status === "missed" ? "down" : c.status === "met" ? "up" : "note", text: c.status + (c.actual != null ? ` (reported ${fmtNum(c.actual, 3)})` : "") }),
      c.rationale ? el("span", { class: "note", text: ` · ${c.rationale}` }) : null,
    ]))));
  }
  if (rv && rv.critics) {
    for (const [k, c] of Object.entries(rv.critics)) {
      b.appendChild(el("h3", { text: `${c.role}${c.valid ? "" : " (out: " + (c.error || "too many arguments failed the check") + ")"}` }));
      if (c.overall) b.appendChild(el("p", { text: c.overall }));
      b.appendChild(argList(rv, c.arguments));
      if (c.dropped) b.appendChild(el("p", { class: "note", text: `${c.dropped} argument(s) dropped: a number did not recompute from the facts.` }));
      if ((c.driver_flags || []).length) b.appendChild(el("ul", {}, c.driver_flags.map((f) => el("li", { text: `${f.driver} ${f.year}: ${f.issue}` }))));
    }
  }
  b.appendChild(el("h3", { text: "Deterministic checks" }));
  const ov = r.outside_view || {};
  const lines = [];
  for (const k of ["bear", "base", "bull", "price_needs"]) {
    const x = ov[k];
    if (x) lines.push(`${k === "price_needs" ? "What today's price needs" : k[0].toUpperCase() + k.slice(1) + " path"}: ${pct(x.cagr, 1)} a year for five years; ${pct(x.pct, 0)} of companies of its size (${x.band}) did that.`);
  }
  if (ov.margin) lines.push(`Margin change, base: ${pct(ov.margin.dm, 1)}; ${pct(ov.margin.pct, 0)} of companies starting in the ${ov.margin.tercile} margin tercile managed that.`);
  for (const c of r.consistency || []) lines.push(`${c.severity.toUpperCase()}: ${c.note}${c.year ? " (" + c.year + ")" : ""}.`);
  const path = (r.drift || {}).path;
  if (path) lines.push(`Drift to ${fmtDate(path.ttm_end)}: revenue ${fmtNum(path.revenue.score, 2)}, EBIT margin ${fmtNum(path.ebit_margin.score, 2)} (0 base, +1 bull, −1 bear)${path.judged ? "" : "; under a quarter of the year has elapsed"}.`);
  if (r.stress) lines.push("Macro stress, change in base value: " + Object.entries(r.stress).map(([k, v]) => `${SHOCK[k] || k} ${pct(v, 0)}`).join(", ") + ".");
  if (r.gate) for (const x of [...(r.gate.reasons || []), ...(r.gate.watch || [])]) lines.push(`Gate: ${x}`);
  b.appendChild(el("ul", {}, lines.map((t) => el("li", { text: t }))));
  kids.push(b);
  host.appendChild(el("div", { class: "panel" }, kids));
}

(async function init() {
  renderShell();
  let D;
  try { D = await loadJSON("data/theses.json"); } catch (e) { showError($("error"), e); return; }
  setAsOf(D.as_of);
  const rs = rows(D);
  const book = rs.filter((r) => r.in_book);
  renderStats("th-strip", [
    { label: "Reviewed", value: `${rs.filter((r) => r.review).length} of ${rs.length}`, delta: `${book.filter((r) => r.review).length} of ${book.length} book names` },
    { label: "Weakened or broken", value: String(rs.filter((r) => r.status === "weakened" || r.status === "broken").length) },
    { label: "Capped", value: String(rs.filter((r) => r.gate && r.gate.cap).length), delta: `at ${pct(D.gate_cap)}` },
    { label: "Flagged for owner", value: String(rs.filter((r) => r.gate && r.gate.flag).length) },
    { label: "Base-rate test", value: D.base_rate_caps ? "caps" : "watch only", delta: `${rs.filter((r) => r.gate && (r.gate.watch || []).length).length} names below 10%` },
  ]);
  table(D);
  const bs = D.book_stress || {};
  if (bs.shocks) {
    renderStats("th-stress", Object.entries(bs.shocks).map(([k, v]) => ({ label: SHOCK[k] || k, value: pct(v, 1), tone: v < 0 ? "down" : "up" })));
    $("th-stress-meta").textContent = `at the model's target weights (${pct(bs.covered, 0)} of the book valued); ` +
      (bs.quadrant_weighted != null ? `macro-quadrant-weighted ${pct(bs.quadrant_weighted, 1)}, descriptive only` : "");
  }
  const want = decodeURIComponent(location.hash.slice(1));
  card(D, want || (book.find((r) => r.review) || rs.find((r) => r.review) || {}).symbol);
})();
