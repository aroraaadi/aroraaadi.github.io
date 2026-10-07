/* Power: global electricity demand and the companies that supply it
   (power/build.py -> data/power.json). */

import { loadJSON, showError, el, fmtPct, fmtDate, renderStats, renderTable, tok, alpha, breakdownColors } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { draw, hbarConfig, applyChartDefaults } from "./charts.js";

const $ = (id) => document.getElementById(id);
let D = null, group = "all";

const pct = (x, dp = 0) => (x == null ? "–" : fmtPct(x, dp));
const spct = (x, dp = 0) => (x == null ? "–" : (x > 0 ? "+" : "") + fmtPct(x, dp));
const mult = (x) => (x == null ? "–" : `${x.toFixed(1)}×`);
const bn = (x) => (x == null ? "–" : x >= 1e12 ? `US$${(x / 1e12).toFixed(2)}tn` : x >= 1e9 ? `US$${(x / 1e9).toFixed(1)}bn` : `US$${(x / 1e6).toFixed(0)}m`);
const link = (url, text) => (url ? el("a", { href: url, target: "_blank", rel: "noopener", text: text || "source" }) : el("span", { text: text || "" }));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } };

/* ---------- demand ---------- */

function demand() {
  const dm = D.demand || {}, G = dm.global || {}, T = D.demand_table || {};
  const regions = (dm.regions || []).filter((r) => r.growth_forecast_pct != null || r.growth_recent_pct != null);
  const dc = dm.data_centres || {};
  renderStats("pw-strip", [
    { label: "World demand growth", value: T.global_pct != null ? `${T.global_pct.toFixed(1)}%` : "–",
      delta: "a year, 2026 to 2030 (IEA)" },
    { label: "World demand", value: G.twh_2025 ? `${Math.round(G.twh_2025).toLocaleString()} TWh` : "–", delta: "2025" },
    { label: "Data centres", value: dc.global_twh_now ? `${Math.round(dc.global_twh_now)} TWh` : "–",
      delta: dc.global_twh_2030_base ? `${Math.round(dc.global_twh_2030_base)} TWh by 2030 (base case)` : "" },
    { label: "Companies", value: String(D.counts.companies), delta: `${D.counts.cards} researched in depth` },
    { label: "Deals on record", value: String(D.counts.deals), delta: "since 2024, each sourced" },
  ]);
  $("pw-d-meta").textContent = "average growth a year, 2026 to 2030 · what drives it";
  const rows = regions.map((r) => ({ ...r, g: r.growth_2026_2030_pct ?? r.growth_forecast_pct })).filter((r) => r.g != null).sort((a, b) => b.g - a.g);
  const wrap = $("pw-d-chart-wrap");
  wrap.style.height = `${Math.max(180, rows.length * 30 + 30)}px`;
  if (rows.length) {
    const acc = tok("--accent"), mut = tok("--muted");
    const cfg = hbarConfig({
      labels: rows.map((r) => r.region), values: rows.map((r) => r.g),
      colors: rows.map((r) => (r.g >= (T.global_pct ?? 0) ? acc : mut)),
      valueLabels: rows.map((r) => `${r.g.toFixed(1)}%`), fmt: (v) => `${v}%`,
    });
    cfg.options.plugins.legend = { display: false };
    draw("pw-d-chart", cfg);
  }
  const list = $("pw-d-list"); list.innerHTML = "";
  rows.forEach((r) => list.appendChild(el("div", { class: "pw-driver" }, [
    el("div", { class: "pw-driver-h" }, [el("strong", { text: r.region }),
      el("span", { class: "note", text: [r.growth_recent_pct != null ? `${r.growth_recent_pct}% in ${r.growth_recent_year || "the latest year"}` : "",
        r.forecast_period ? `forecast ${r.forecast_period}` : ""].filter(Boolean).join(" · ") })]),
    el("div", { class: "note wrap", text: (r.drivers || []).join(" · ") }),
    el("div", { class: "pw-src" }, (r.sources || []).slice(0, 3).map((s) => link(s.url, s.title ? s.title.slice(0, 60) : host(s.url)))),
  ])));
  $("pw-d-note").textContent = [G.notes, (G.forecast || []).map((f) => `${f.period}: ${f.growth_pct_per_year}% a year (${f.source || host(f.url)})`).join("; ")]
    .filter(Boolean).join(" ");
}

function facts(target, items) {
  const box = $(target); box.innerHTML = "";
  items.filter(Boolean).forEach(([k, v, url]) => box.appendChild(el("div", { class: "pw-fact" }, [
    el("span", { class: "pw-fact-k", text: k }), el("span", { class: "pw-fact-v" }, [el("span", { text: v }), url ? el("span", { text: " " }) : null, url ? link(url, host(url)) : null].filter(Boolean)),
  ])));
  if (!box.children.length) box.appendChild(el("p", { class: "note", text: "Not researched yet." }));
}

function dcAndConstraints() {
  const dm = D.demand || {}, dc = dm.data_centres || {}, us = dm.us_market || {};
  const src0 = (a) => (a || [])[0]?.url;
  facts("pw-dc", [
    dc.global_twh_now ? ["World data centres", `${dc.global_twh_now} TWh in ${dc.global_twh_now_year || "the latest year"}` +
      (dc.global_twh_2030_base ? `; ${dc.global_twh_2030_base} TWh by 2030 in the base case` : "") +
      (dc.global_twh_2030_range ? ` (range ${dc.global_twh_2030_range.join("–")})` : ""), src0(dc.sources)] : null,
    dc.us_share_of_load_now_pct != null ? ["US share of load", `${dc.us_share_of_load_now_pct}% now` +
      (dc.us_share_2030_range_pct ? `; ${dc.us_share_2030_range_pct.join("–")}% by 2030` : ""), src0(dc.sources)] : null,
    ...(us.pjm_capacity_prices || []).map((p) => [`PJM capacity, ${p.delivery_year}`, p.usd_per_mw_day != null ? `US$${p.usd_per_mw_day}/MW-day` : "–", p.url]),
    us.ercot_large_load_queue_gw != null ? ["ERCOT large-load queue", `${us.ercot_large_load_queue_gw} GW (${us.ercot_queue_date || ""})`, src0(us.sources)] : null,
    us.utility_load_forecast ? ["US utility forecasts", us.utility_load_forecast, src0(us.sources)] : null,
    us.interconnection_queue ? ["Interconnection queue", us.interconnection_queue, src0(us.sources)] : null,
    ...(dc.hotspots || []).slice(0, 8).map((h) => [h.place, h.detail, h.url]),
  ]);
  facts("pw-con", [
    ...(dm.constraints || []).map((c) => [c.item, [c.detail, c.lead_time ? `Lead time: ${c.lead_time}.` : ""].filter(Boolean).join(" "), c.url]),
    ...(dm.supply_mix || []).map((s) => [`New supply, ${s.region}`, s.detail, s.url]),
  ]);
}

/* ---------- companies ---------- */

function whereLabel(r) {
  const e = r.demand_exposure;
  if (e?.parts?.length) return e.parts.slice(0, 3).map((p) => `${p.region} ${Math.round(p.share * 100)}%`).join(" · ");
  const served = r.card?.geographies?.served;
  return served?.length ? served.slice(0, 4).join(", ") : "–";
}

function groups() {
  const box = $("pw-groups"); box.innerHTML = "";
  const opts = [["all", "All"], ...Object.entries(D.groups)];
  opts.forEach(([k, label]) => {
    const b = el("button", { text: k === "all" ? "All" : label.replace(/ and onsite power| and data-centre power equipment|: reactors, fuel and enrichment/, ""), "aria-pressed": String(k === group) });
    if (k === group) b.classList.add("active");
    b.addEventListener("click", () => { group = k; groups(); table(); });
    box.appendChild(b);
  });
}

function table() {
  const rows = D.companies.filter((r) => group === "all" || r.group === group).map((r) => ({
    ...r, exp: r.demand_exposure?.growth_pct ?? null, fy1: r.street?.rev_growth_fy1 ?? null, deals_n: (r.card?.deals || []).length,
  }));
  renderTable($("pw-table"), rows, [
    { key: "symbol", label: "Company", fmt: (v, r) => el("span", { class: "pw-co" }, [
      el(r.card ? "a" : "span", { class: "sym", text: v, href: r.card ? `#card-${cssId(v)}` : undefined }),
      el("span", { class: "note", text: ` ${r.name}` }), r.otc_line ? el("span", { class: "pill", text: "OTC", title: `US line ${r.otc_line} trades over the counter` }) : null].filter(Boolean)) },
    { key: "group", label: "Role", cls: () => "note", fmt: (v) => SHORT[v] || v },
    { key: "mcap_usd", label: "Value", num: true, fmt: bn },
    { key: "exp", label: "Its markets grow", num: true, fmt: (v, r) => el("span", { title: r.demand_exposure ? `mapped ${Math.round(r.demand_exposure.mapped_share * 100)}% of the mix · ${r.mix_source?.source || ""}` : "", text: v == null ? "–" : `${v.toFixed(1)}%` }) },
    { key: "where", label: "Where it sells", cls: () => "note wrap", fmt: (_, r) => whereLabel(r) },
    { key: "rev_growth_ttm", label: "Revenue growth", num: true, fmt: (v) => spct(v) },
    { key: "fy1", label: "Street, next year", num: true, fmt: (v) => spct(v) },
    { key: "ebitda_margin", label: "EBITDA margin", num: true, fmt: (v) => pct(v) },
    { key: "ev_to_ebitda", label: "EV/EBITDA", num: true, fmt: mult },
    { key: "net_debt_to_ebitda", label: "Net debt/EBITDA", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(1)) },
    { key: "ret_1y", label: "1 year", num: true, fmt: (v) => el("span", { class: v == null ? "" : v >= 0 ? "up" : "down", text: spct(v) }) },
    { key: "deals_n", label: "Deals", num: true, fmt: (v) => (v ? String(v) : "–") },
  ], { sortKey: "mcap_usd", dir: -1 });
  const th = $("pw-table").querySelector("thead tr");
  if (!th.children.length) {/* renderTable writes headers itself */}
  $("pw-c-meta").textContent = `${rows.length} companies · ${rows.filter((r) => r.card).length} with a card`;
  $("pw-c-note").textContent = "Measures are the trailing four quarters from FMP (for a foreign company, its latest fiscal year, " +
    "converted to US dollars). \"Its markets grow\" is the forecast electricity-demand growth of the regions in its revenue or " +
    "capacity mix, weighted by that mix; hover for how much of the mix was mapped. \"Street, next year\" is the analysts' " +
    "average revenue forecast for the next fiscal year against the last reported one.";
}

const cssId = (s) => s.replace(/[^A-Za-z0-9]/g, "-");
const SHORT = { ipp: "Power producer", nuclear: "Nuclear", onsite: "Generation equipment", grid: "Grid equipment",
  storage_solar: "Storage and solar", utility: "US utility", gas: "Gas", intl: "International" };

/* ---------- growth against price ---------- */

function scatter() {
  const pts = D.companies.filter((r) => r.ev_to_ebitda != null && r.street?.rev_growth_fy1 != null && r.ev_to_ebitda < 80);
  const groupsList = Object.keys(D.groups), cols = breakdownColors(groupsList.length);
  const datasets = groupsList.map((g, i) => ({
    label: D.groups[g], backgroundColor: alpha(cols[i], 0.85), borderColor: cols[i], pointRadius: 5, pointHoverRadius: 7,
    data: pts.filter((r) => r.group === g).map((r) => ({ x: r.street.rev_growth_fy1 * 100, y: r.ev_to_ebitda, sym: r.symbol })),
  })).filter((d) => d.data.length);
  // Label a point only where the label has room; the rest show on hover.
  const labelPlugin = { id: "pwLabels", afterDatasetsDraw(chart) {
    const ctx = chart.ctx, area = chart.chartArea, boxes = [];
    ctx.save(); ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = tok("--ink-2");
    const pts = [];
    chart.data.datasets.forEach((ds, di) => chart.getDatasetMeta(di).data.forEach((pt, j) => pts.push({ x: pt.x, y: pt.y, t: ds.data[j].sym })));
    pts.forEach((p) => boxes.push({ x0: p.x - 5, y0: p.y - 5, x1: p.x + 5, y1: p.y + 5 }));
    pts.sort((a, b) => Math.abs(b.y - area.bottom) - Math.abs(a.y - area.bottom));
    for (const p of pts) {
      const w = ctx.measureText(p.t).width;
      let x = p.x + 7; if (x + w > area.right) x = p.x - 7 - w;
      const b = { x0: x, y0: p.y - 13, x1: x + w, y1: p.y - 2 };
      if (boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) continue;
      boxes.push(b); ctx.fillText(p.t, x, p.y - 4);
    }
    ctx.restore();
  } };
  draw("pw-scatter", {
    type: "scatter", data: { datasets },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { right: 24, top: 8 } },
      scales: { x: { title: { display: true, text: "Street revenue growth, next fiscal year (%)" }, grid: { color: tok("--grid") } },
                y: { title: { display: true, text: "EV / EBITDA, trailing" }, grid: { color: tok("--grid") } } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } },
        tooltip: { callbacks: { label: (c) => ` ${c.raw.sym}: growth ${c.raw.x.toFixed(0)}%, ${c.raw.y.toFixed(1)}× EBITDA` } } } },
    plugins: [labelPlugin],
  });
  const left = D.companies.filter((r) => r.ev_to_ebitda != null && r.ev_to_ebitda >= 80).map((r) => `${r.symbol} ${r.ev_to_ebitda.toFixed(0)}×`);
  $("pw-s-note").textContent = "Up and to the left is paying more for less growth; down and to the right the reverse. Names without " +
    "positive EBITDA or a Street forecast are left out" + (left.length ? `, and so are multiples above 80× (${left.join(", ")})` : "") + ".";
}

/* ---------- deals ---------- */

function deals() {
  renderTable($("pw-deals"), D.deals, [
    { key: "sort_date", label: "Date", fmt: (_, r) => r.date || "–" },
    { key: "symbol", label: "Company", fmt: (v) => el("a", { class: "sym", text: v, href: `#card-${cssId(v)}` }) },
    { key: "counterparty", label: "With, and what", cls: () => "wrap pw-deal-what", fmt: (v, r) => el("div", {}, [
      el("div", { class: "pw-deal-cp", text: v || "–" }),
      el("div", { class: "note" }, [el("span", { text: `${r.description || ""} ` }), r.url ? link(r.url, host(r.url)) : null].filter(Boolean))]) },
    { key: "type", label: "Type", cls: () => "note" },
    { key: "size", label: "Size", cls: () => "note wrap pw-deal-size" },
    { key: "value_usd", label: "Value", num: true, fmt: (v) => (v ? bn(v) : "–") },
    { key: "term_years", label: "Years", num: true, fmt: (v) => (v ? String(v) : "–") },
  ], { sortKey: "sort_date", dir: -1 });
  const n = new Set(D.deals.map((d) => d.symbol)).size;
  $("pw-deal-meta").textContent = `${D.deals.length} deals across ${n} companies`;
}

/* ---------- cards ---------- */

function card(r) {
  const c = r.card;
  const sec = (title, kids) => { kids = (kids || []).filter(Boolean); return kids.length ? el("div", { class: "pw-sec" }, [el("h4", { text: title }), ...kids]) : null; };
  const real = (v) => v != null && String(v).trim() !== "" && String(v).trim().toLowerCase() !== "null";
  const p = (t) => (t ? el("p", { text: t }) : null);
  const ul = (items) => (items && items.length ? el("ul", {}, items.map((x) => el("li", {}, typeof x === "string" ? [el("span", { text: x })] : x))) : null);
  const geo = c.geographies || {};
  const mix = (geo.mix || []).filter((m) => m.share_pct != null).map((m) => `${m.region} ${m.share_pct}%${m.basis ? ` of ${m.basis}` : ""}${m.year ? ` (${m.year})` : ""}`);
  const kids = [
    el("div", { class: "pw-card-top" }, [
      el("div", {}, [el("p", { class: "pw-seg", text: c.segment || r.group_label }), p(c.business_model)]),
      el("div", { class: "pw-card-nums" }, [
        ["Value", bn(r.mcap_usd)], ["Revenue", bn(r.revenue_ttm_usd)], ["Growth", spct(r.rev_growth_ttm)],
        ["EBITDA margin", pct(r.ebitda_margin)], ["EV/EBITDA", mult(r.ev_to_ebitda)], ["Its markets grow", r.demand_exposure ? `${r.demand_exposure.growth_pct.toFixed(1)}%` : "–"],
      ].map(([k, v]) => el("div", {}, [el("span", { class: "k", text: k }), el("span", { class: "v", text: v })]))),
    ]),
    sec("What it sells", [ul(c.products)]),
    sec("Where", [p((geo.served || []).join(", ")), mix.length ? p(mix.join(" · ")) : null].filter(Boolean)),
    sec("Capacity", [p(c.capacity)].filter(Boolean)),
    sec("Backlog and contracted position", c.backlog?.detail ? [el("p", {}, [el("span", { text: `${c.backlog.detail}${c.backlog.date ? ` (${c.backlog.date})` : ""} ` }), link(c.backlog.url, c.backlog.url ? host(c.backlog.url) : "")])] : []),
    sec("Moat", c.moat ? [ul(c.moat.sources), p(c.moat.evidence), c.moat.weakness ? el("p", { class: "pw-weak" }, [el("strong", { text: "Weakness. " }), el("span", { text: c.moat.weakness })]) : null].filter(Boolean) : []),
    sec("AI and data-centre exposure", [p(c.ai_exposure)].filter(Boolean)),
    sec("Home market", [p(c.home_demand)].filter(Boolean)),
    sec("Guidance", [ul((c.guidance || []).filter((g) => real(g.value)).map((g) => [el("span", { text: `${g.item}: ${g.value} ` }), g.url ? link(g.url, host(g.url)) : null].filter(Boolean)))]),
    sec("Deals", [ul((c.deals || []).map((d) => [el("span", { text: `${[d.date, d.counterparty, d.size, d.value_usd ? bn(d.value_usd) : null].filter(real).join(" · ")}: ${d.description || ""} ` }), d.url ? link(d.url, host(d.url)) : null].filter(Boolean)))]),
    sec("Risks", [ul(c.risks)]),
    sec("Could not verify", [ul(c.unverified)]),
    sec("Sources", [el("p", { class: "pw-src" }, (c.sources || []).map((u) => link(u, host(u))))]),
  ].filter(Boolean);
  return el("details", { class: "pw-card", id: `card-${cssId(r.symbol)}` }, [
    el("summary", {}, [el("span", { class: "sym", text: r.symbol }), el("span", { class: "pw-card-name", text: r.name }),
      el("span", { class: "note", text: [c.hq_country, c.listing, r.otc_line ? `US line ${r.otc_line} (OTC)` : c.us_line?.ticker ? `US line ${c.us_line.ticker} (${c.us_line.venue})` : ""].filter(Boolean).join(" · ") })]),
    el("div", { class: "pw-card-b" }, kids),
  ]);
}

function cards() {
  const box = $("pw-cards"); box.innerHTML = "";
  Object.entries(D.groups).forEach(([g, label]) => {
    const rs = D.companies.filter((r) => r.group === g && r.card);
    if (!rs.length) return;
    box.appendChild(el("h3", { class: "pw-group-h", text: label }));
    rs.sort((a, b) => (b.mcap_usd || 0) - (a.mcap_usd || 0)).forEach((r) => box.appendChild(card(r)));
  });
  const open = () => { const t = location.hash && document.getElementById(location.hash.slice(1)); if (t && t.tagName === "DETAILS") { t.open = true; t.scrollIntoView({ block: "start" }); } };
  window.addEventListener("hashchange", open); open();
}

(async function init() {
  renderShell();
  try { D = await loadJSON("data/power.json"); } catch (err) { showError($("error"), err); return; }
  setAsOf(D.as_of);
  demand(); dcAndConstraints(); groups(); table(); scatter(); deals(); cards();
  $("pw-method").textContent = D.method;
  onThemeChange(() => { applyChartDefaults(); demand(); scatter(); });
})();
