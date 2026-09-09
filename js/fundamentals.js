/* Fundamentals: a dense sortable table of every holding / radar name, with an
   expandable detail row. Replaces the previous card-per-name layout, which cost
   ~9,500px of scroll for 17 names. */

import {
  loadJSON, showError, fmtPct, fmtNum, fmtMoney, el, renderTable,
} from "./common.js";
import { renderShell, setAsOf, registerCommands } from "./shell.js";

let DATA = null, THEMES = null, scope = "holdings", sortKey = "weight";

const num = (v, dp = 1) => (v == null ? "—" : Number(v).toFixed(dp));
const sign = (v) => (v == null ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "");

function rows() {
  return (DATA[scope] || []).map((d) => ({
    symbol: d.symbol, name: d.name, sector: d.sector || (d.is_fund ? "Fund" : "—"),
    is_fund: d.is_fund, weight: d.weight,
    price: d.price, mcap: d.market_cap,
    pe: d.valuation?.pe, ps: d.valuation?.ps, ev: d.valuation?.evEbitda,
    fcfy: d.valuation?.fcfYield,
    gm: d.profitability?.grossMargin, om: d.profitability?.operatingMargin,
    roe: d.profitability?.roe, roic: d.profitability?.roic,
    rev: d.growth?.revenue, ni: d.growth?.netIncome,
    de: d.health?.debtToEquity, cr: d.health?.currentRatio, z: d.health?.altmanZ,
    theme: THEMES?.[d.symbol]?.primary_theme || null,
    tier: THEMES?.[d.symbol]?.primary_tier || null,
    themeScore: THEMES?.[d.symbol]?.primary_score ?? null,
    raw: d,
  }));
}

/* Sparkline as inline SVG — 24 names x 3 charts is far too many Chart.js
   instances, and a sparkline needs no axis machinery. */
function spark(series, get, color) {
  const pts = (series || []).filter((d) => get(d) != null);
  if (pts.length < 2) return el("span", { class: "note", text: "—" });
  const v = pts.map(get), lo = Math.min(...v, 0), hi = Math.max(...v, 0), span = hi - lo || 1;
  const W = 68, H = 18;
  const d = pts.map((p, i) =>
    `${i ? "L" : "M"}${(i / (pts.length - 1) * W).toFixed(1)},${(H - (get(p) - lo) / span * H).toFixed(1)}`).join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${pts.length} periods, latest ${get(pts[pts.length - 1])}`);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d); path.setAttribute("fill", "none");
  path.setAttribute("stroke", `var(${color})`); path.setAttribute("stroke-width", "1.5");
  svg.appendChild(path);
  return svg;
}

function detail(d) {
  const box = document.getElementById("detail");
  box.innerHTML = "";
  if (!d) return;
  const kv = (label, v) => el("div", { class: "stat" }, [
    el("div", { class: "stat-l", text: label }), el("div", { class: "stat-v", text: v })]);

  const head = el("div", { class: "panel-h" }, [
    el("h2", { text: `${d.symbol} — ${d.name || ""}` }),
    el("span", { class: "spacer" }),
    el("span", { class: "note",
      text: [d.exchange, d.currency, d.fiscal_year ? `FY${d.fiscal_year}` : null,
             d.statement_currency].filter(Boolean).join(" · ") }),
  ]);

  const kids = [head];
  if (d.is_fund) {
    kids.push(el("div", { class: "panel-b flush" }, [
      el("div", { class: "strip", style: "margin:0;border:0" }, [
        kv("Holdings", String(d.holdings_count ?? "—")),
        kv("Expense ratio", d.expense_ratio != null ? num(d.expense_ratio, 2) + "%" : "—"),
        kv("AUM", fmtMoney(d.aum)),
      ]),
    ]));
    const hs = (d.holdings || []).slice(0, 10);
    if (hs.length) {
      const mx = Math.max(...hs.map((h) => h.weight || 0), 1);
      kids.push(el("div", { class: "panel-b" }, [
        el("h2", { text: "Top constituents" }),
        el("div", {}, hs.map((h) => el("div", {
          style: "display:grid;grid-template-columns:70px 1fr 54px;gap:8px;align-items:center;padding:2px 0" }, [
          el("span", { class: "sym", text: h.asset || "—" }),
          el("span", { class: "meter" }, [el("i", { style: `width:${(h.weight / mx * 100).toFixed(1)}%` })]),
          el("span", { class: "num", text: num(h.weight, 1) + "%" }),
        ]))),
      ]));
    }
  } else {
    const i = d.income || {}, b = d.balance || {}, c = d.cashflow || {};
    kids.push(el("div", { class: "panel-b flush" }, [
      el("div", { class: "strip", style: "margin:0;border:0" }, [
        kv("Revenue", fmtMoney(i.revenue)), kv("EBITDA", fmtMoney(i.ebitda)),
        kv("Net income", fmtMoney(i.netIncome)), kv("Operating CF", fmtMoney(c.operatingCashFlow)),
        kv("Free cash flow", fmtMoney(c.freeCashFlow)), kv("Cash", fmtMoney(b.cash)),
        kv("Total debt", fmtMoney(b.totalDebt)), kv("Total assets", fmtMoney(b.totalAssets)),
      ]),
    ]));
    const segs = (d.segments || []).slice(0, 8);
    if (segs.length) {
      const mx = Math.max(...segs.map((s) => s.value || 0), 1);
      kids.push(el("div", { class: "panel-b" }, [
        el("h2", { text: "Revenue by segment" }),
        el("div", {}, segs.map((s) => el("div", {
          style: "display:grid;grid-template-columns:minmax(90px,200px) 1fr 70px;gap:8px;align-items:center;padding:2px 0" }, [
          el("span", { text: s.segment }),
          el("span", { class: "meter" }, [el("i", { style: `width:${(s.value / mx * 100).toFixed(1)}%` })]),
          el("span", { class: "num", text: fmtMoney(s.value) }),
        ]))),
      ]));
    }
  }
  box.appendChild(el("div", { class: "panel" }, kids));
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const SORTS = { weight: "weight", pe: "pe", roic: "roic", revenue: "rev", theme: "themeScore" };

function paint() {
  const data = rows();
  const key = SORTS[sortKey] || "weight";
  const dir = key === "pe" ? 1 : -1;   // cheapest first for P/E, biggest first otherwise
  data.sort((a, b) => {
    if (a.is_fund !== b.is_fund && key !== "weight") return a.is_fund ? 1 : -1;
    const x = a[key], y = b[key];
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir;
  });

  const t = renderTable(document.getElementById("fx-table"), data, [
    { key: "symbol", label: "Sym", fmt: (v, r) => {
        const a = el("a", { href: "#", class: "sym", text: v });
        a.addEventListener("click", (e) => { e.preventDefault(); detail(r.raw); });
        return a;
      } },
    { key: "sector", label: "Sector" },
    // Theme tag from the ETF-intersection signal. Tier is the honest part —
    // "core" means thematic ETFs own it, not that it earns theme revenue.
    { key: "theme", label: "Theme", fmt: (v, r) =>
        v ? el("span", { class: "pill", title: `${r.tier} · score ${r.themeScore?.toFixed(2)}`,
                         text: `${v}·${(r.tier || "").split("_")[0]}` })
          : el("span", { class: "note", text: "—" }) },
    { key: "weight", label: "Wt", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v, 2)) },
    { key: "price", label: "Price", num: true, fmt: (v) => (v == null ? "—" : "$" + num(v, 2)) },
    { key: "mcap", label: "Mkt cap", num: true, fmt: fmtMoney },
    { key: "pe", label: "P/E", num: true, fmt: (v) => num(v, 1) },
    { key: "ev", label: "EV/EBITDA", num: true, fmt: (v) => num(v, 1) },
    { key: "fcfy", label: "FCF yld", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v)), cls: (r) => sign(r.fcfy) },
    { key: "gm", label: "Gross m.", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v)) },
    { key: "om", label: "Op m.", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v)), cls: (r) => sign(r.om) },
    { key: "roe", label: "ROE", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v)), cls: (r) => sign(r.roe) },
    { key: "roic", label: "ROIC", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v)), cls: (r) => sign(r.roic) },
    { key: "rev", label: "Rev gr.", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v)), cls: (r) => sign(r.rev) },
    { key: "ni", label: "NI gr.", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v)), cls: (r) => sign(r.ni) },
    { key: "de", label: "D/E", num: true, fmt: (v) => num(v, 2) },
    { key: "z", label: "Altman Z", num: true, fmt: (v) => num(v, 1),
      cls: (r) => (r.z == null ? "" : r.z > 3 ? "pos" : r.z < 1.8 ? "neg" : "") },
    { key: "trend", label: "Revenue", fmt: (_, r) =>
        spark(r.raw.history, (h) => h.revenue, "--s2") },
  ], { sortKey: key, dir });

  document.getElementById("count").textContent =
    `${data.length} ${scope === "holdings" ? "positions" : "watchlist names"}`;
  detail(null);
  return t;
}

function wire(id, attr, set) {
  document.getElementById(id).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    [...e.currentTarget.querySelectorAll("button")].forEach((x) => {
      const on = x === b;
      x.classList.toggle("active", on);
      if (x.hasAttribute("aria-selected")) x.setAttribute("aria-selected", String(on));
    });
    set(b.dataset[attr]);
    paint();
  });
}

(async function init() {
  renderShell();
  const content = document.getElementById("content");
  try { DATA = await loadJSON("data/fundamentals.json"); }
  catch (err) { showError(content, err); return; }
  // Theme tags are additive — a missing file must not take the page down.
  THEMES = await loadJSON("data/themes.json")
    .then((t) => Object.fromEntries(t.securities.map((r) => [r.symbol, r])))
    .catch(() => null);
  setAsOf(DATA.as_of);
  document.getElementById("note").textContent = DATA.note || "";
  registerCommands([...(DATA.holdings || []), ...(DATA.radar || [])].map((d) => ({
    key: d.symbol, hint: d.is_fund ? "fund" : (d.sector || ""),
    act: () => { scope = d.role === "radar" ? "radar" : "holdings"; paint(); detail(d); },
  })));
  wire("scope", "scope", (v) => { scope = v; });
  wire("sortby", "sort", (v) => { sortKey = v; });
  paint();
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) {
    const hit = [...(DATA.holdings || []), ...(DATA.radar || [])].find((d) => d.symbol === hash);
    if (hit) detail(hit);
  }
})();
