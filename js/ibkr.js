/* IBKR: one income ETF and cash, and whether the distribution pays the
   account's market-data bill.

   ibkr.json is rebuilt every evening by run_daily (ibkr_account.py) from a
   read-only TWS snapshot. Dollar figures are published by the owner's choice
   (2026-10-06), like the home tracker. Fees are inferred from cash, not read
   from a statement, and the page says so where they appear. */

import { loadJSON, showError, el, fmtDate, renderStats, renderTable, tok, alpha, tone, signedPct as pct,
         money as cad, signedMoney } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { draw, lineConfig, applyChartDefaults } from "./charts.js";

const $ = (id) => document.getElementById(id);
const money = (x, dp = 2) => cad(x, "CAD", dp);
const signed = (x, dp = 2) => signedMoney(x, "CAD", dp);
const set = (id, t) => { const n = $(id); if (n) n.textContent = t; };
const month = (k) => new Date(`${k}-15T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });
let D = null;

function head() {
  const c = D.coverage, h = D.headline, p = D.positions[0];
  set("ib-verdict", c.covers
    ? `The dividend pays for the data, ${c.ratio.toFixed(1)} times over`
    : `The dividend does not cover the data: ${Math.round(c.ratio * 100)}% of the bill`);
  set("ib-sub", p
    ? `${p.shares} shares of ${p.symbol} pay ${money(p.dividend_per_share)} each a month, ${money(c.monthly_income)} in all; ` +
      `the market-data subscription was last charged at ${money(c.bill_charged)} (${money(c.bill_stated)} stated). ` +
      `${c.covers ? `${money(c.surplus)} a month is left over.` : `${money(-c.surplus)} a month short.`}`
    : "No position held.");
  set("ib-meta", `As of ${fmtDate(D.as_of)} · ${D.source === "tws" ? "TWS, read-only" : "IBKR PortfolioAnalyst"} · updated every evening`);
  renderStats("ib-strip", [
    { label: "Account value", value: money(h.nav), delta: `since ${fmtDate(h.since)}` },
    { label: "Put in", value: money(h.contributed, 0), delta: `${signed(h.gain)} (${pct(h.twr)}) on it`, deltaTone: tone(h.gain) },
    { label: "Cash", value: money(h.cash), delta: h.accrued ? `${money(h.accrued)} dividend payable` : "nothing payable" },
    { label: "Dividends to date", value: money(c.to_date.dividends), tone: "up", delta: `${D.dividends.length} distributions` },
    { label: "Data fees to date", value: money(c.to_date.fees), tone: c.to_date.fees ? "down" : "",
      delta: c.to_date.first_fee ? `${c.to_date.n_fees} charges since ${fmtDate(c.to_date.first_fee)}` : "none yet" },
  ]);
}

/* Income against the bill on one scale, then the same in shares: how many it
   takes to pay the bill at today's distribution, and how many are held. */
function cover() {
  const c = D.coverage, p = D.positions[0];
  const host = $("ib-cover"); host.innerHTML = "";
  const max = Math.max(c.monthly_income, c.bill_charged, c.bill_stated) * 1.08;
  const bar = (label, v, cls, sub) => el("div", { class: "ib-row" }, [
    el("span", { class: "ib-l", text: label }),
    el("span", { class: "ib-track" }, [el("i", { class: cls, style: `width:${(v / max) * 100}%` })]),
    el("span", { class: "ib-v", text: money(v) }),
    el("span", { class: "note ib-s", text: sub }),
  ]);
  host.appendChild(bar("Distribution, a month", c.monthly_income, "inc",
    p ? `${p.shares} × ${money(p.dividend_per_share, 2)}` : ""));
  host.appendChild(bar("Data bill, charged", c.bill_charged, "fee", "last charge, inferred from cash"));
  host.appendChild(bar("Data bill, stated", c.bill_stated, "fee light", "the subscription's listed price"));
  if (p && c.breakeven_shares) {
    const top = Math.max(p.shares, c.breakeven_shares) * 1.15;
    host.appendChild(el("div", { class: "ib-shares", role: "img",
      "aria-label": `Break-even at ${c.breakeven_shares} shares; ${p.shares} held` }, [
      el("span", { class: "ib-l", text: "Shares" }),
      el("span", { class: "ib-track" }, [
        el("i", { class: "held", style: `width:${(p.shares / top) * 100}%` }),
        el("b", { class: "mark", style: `left:${(c.breakeven_shares / top) * 100}%`, title: "break-even" }),
      ]),
      el("span", { class: "ib-v", text: `${p.shares} held` }),
      el("span", { class: "note ib-s", text: `${c.breakeven_shares} pay the bill` }),
    ]));
  }
  set("ib-cover-note",
    `At today's distribution the bill needs ${c.breakeven_shares} shares; the account holds ${p ? p.shares : 0}. ` +
    `The distribution could fall to ${money(c.breakeven_per_share, 3)} a share before it stops covering the bill. ` +
    `Since the first charge the account has earned ${money(c.to_date.dividends)} in distributions against ${money(c.to_date.fees)} in fees ` +
    `(${c.to_date.ratio ? `${c.to_date.ratio.toFixed(1)}×` : "no fees"}). ${D.method.coverage}`);
}

function months() {
  const M = D.monthly, inc = tok("--up"), fee = tok("--down"), grid = tok("--grid"), base = tok("--baseline");
  draw("ib-months", {
    type: "bar",
    data: { labels: M.map((m) => month(m.month)), datasets: [
      { label: "Distributions", data: M.map((m) => m.dividends), backgroundColor: alpha(inc, 0.85), borderRadius: 2, barPercentage: 0.8, categoryPercentage: 0.7 },
      { label: "Data fees", data: M.map((m) => m.fees), backgroundColor: alpha(fee, 0.8), borderRadius: 2, barPercentage: 0.8, categoryPercentage: 0.7 },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: (c) => ` ${c.dataset.label}: ${money(c.parsed.y)}`,
        footer: (it) => { const m = M[it[0].dataIndex]; return `Net ${signed(m.net)}`; } } } },
      scales: { x: { grid: { display: false }, border: { color: base } },
                y: { grid: { color: grid }, border: { display: false }, beginAtZero: true, ticks: { callback: (v) => `CA$${v}` } } },
    },
  });
  const lg = $("ib-months-legend"); lg.innerHTML = "";
  [["Distributions, by ex-date", alpha(inc, 0.85)], ["Data fees", alpha(fee, 0.8)]].forEach(([t, c]) =>
    lg.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-rect", style: `background:${c}` }), el("span", { text: t })])));
  set("ib-months-note", `${D.method.dividends} ${D.method.fees}`);
}

function position() {
  renderTable($("ib-pos"), D.positions, [
    { key: "symbol", label: "Holding", fmt: (v, r) => el("span", { class: "tk-sym" }, [el("span", { class: "sym", text: v }), el("span", { class: "tk-ccy cad", text: r.currency })]) },
    { key: "name", label: "Fund", cls: () => "tk-name" },
    { key: "shares", label: "Shares", num: true },
    { key: "price", label: "Price", num: true, fmt: (v) => money(v) },
    { key: "value", label: "Value", num: true, fmt: (v) => money(v) },
    { key: "avg_cost", label: "Avg cost", num: true, fmt: (v, r) => el("span", {}, [el("span", { text: money(v, 3) }), el("span", { class: `tk-vs ${tone(r.gain_pct)}`, text: ` (${pct(r.gain_pct)})` })]) },
    { key: "dividend_per_share", label: "Paid a month", num: true, fmt: (v) => money(v) },
    { key: "yield_on_price", label: "Yield at price", num: true, fmt: (v) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`) },
    { key: "monthly_income", label: "Income a month", num: true, fmt: (v) => money(v) },
  ]);
  set("ib-pos-note", "Yield at price is twelve times the latest monthly distribution over today's price. A distribution this " +
    "high is paid partly from option premium and capital, not only from the underlying companies' dividends.");
}

function nav() {
  const S = D.series, accent = tok("--accent"), muted = tok("--muted");
  const cfg = lineConfig({ labels: S.map((p) => p.date), yFmt: (v) => `CA$${Math.round(v)}`, series: [
    { label: "Account value", data: S.map((p) => p.nav), color: accent, fill: true },
    { label: "Put in", data: S.map((p) => p.contributed), color: muted, dash: [5, 4], width: 1.5 },
  ] });
  cfg.data.datasets[1].stepped = true;
  cfg.options.plugins.legend = { display: false };
  cfg.options.plugins.tooltip = { callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.parsed.y)}` } };
  draw("ib-nav", cfg);
  const lg = $("ib-nav-legend"); lg.innerHTML = "";
  [["Account value", accent], ["Put in", muted]].forEach(([t, c]) =>
    lg.appendChild(el("span", { class: "key" }, [el("span", { class: "swatch-line", style: `border-top-color:${c}` }), el("span", { text: t })])));
}

const KIND = { deposit: "Deposit", withdrawal: "Withdrawal", buy: "Bought", sell: "Sold", dividend: "Distribution", fee: "Data fee", credit: "Credit" };

function ledger() {
  const rows = [...D.ledger].reverse();
  renderTable($("ib-ledger"), rows, [
    { key: "date", label: "Date", fmt: (v) => el("span", { class: "tk-date", text: v }) },
    { key: "kind", label: "What", fmt: (v) => el("span", { class: `pill ${v === "dividend" || v === "deposit" ? "on" : v === "fee" ? "down" : "muted"}`, text: KIND[v] || v }) },
    { key: "amount", label: "Cash", num: true, fmt: (v) => el("span", { class: `tk-vs ${tone(v)}`, text: signed(v) }) },
    { key: "note", label: "Detail", cls: () => "note" },
  ], { sortKey: "date", dir: -1 });
  set("ib-ledger-note", D.method.cash);
}

function paint() { months(); nav(); }

(async function init() {
  renderShell();
  try {
    D = await loadJSON("data/ibkr.json");
  } catch (err) {
    showError($("error"), err); return;
  }
  setAsOf(D.as_of);
  head(); cover(); paint(); position(); ledger();
  onThemeChange(() => { applyChartDefaults(); paint(); });
})();
