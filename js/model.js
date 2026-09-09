/* Model page controller: load a ticker, render the linked grids, run the DCF. */

import { loadJSON, showError, el, renderStats, fmtMoney, fmtPct, fmtNum } from "./common.js";
import { renderShell, setAsOf, registerCommands } from "./shell.js";
import * as FMP from "./fmp.js";
import { seedDrivers, project, historyRows, DRIVER_DEFS } from "./model/engine.js";
import { renderGrid, FORMATS } from "./model/grid.js";
import { valuate, sensitivity, impliedGrowth, verifyAgainstFmp } from "./model/dcf.js";

const STORE = (sym) => `qp-model-${sym}`;
let M = null, drivers = [], overrides = {}, assumptions = {}, interestMode = "avg";
let CURATED = null;   // curated starting assumptions, loaded once

const status = (t, bad = false) => {
  const n = document.getElementById("status");
  n.textContent = t;
  n.className = bad ? "note disclosure" : "note";
};

/* ---------------- load ---------------- */

async function load(symbol) {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  status(`Loading ${sym}…`);
  try {
    // Pre-built payloads cover the portfolio + watchlist so the page works with
    // no key; anything else needs the user's own.
    let raw = await loadJSON(`data/models/${sym}.json`).catch(() => null);
    if (raw) {
      M = FMP.normalize(raw);
      status(`${M.name} — pre-built payload.`);
    } else if (FMP.hasKey()) {
      M = await FMP.fetchTicker(sym);
      status(`${M.name} — fetched live from FMP.`);
    } else {
      status(`${sym} is not pre-built. Add your FMP API key to model any ticker.`, true);
      promptKey();
      return;
    }
  } catch (err) {
    status(`${sym}: ${err.message}`, true);
    return;
  }

  M.projLabels = M.street.map((s) => "FY" + s.date.slice(2, 4));
  M.projYears = M.street.map((s) => +s.date.slice(0, 4));
  if (!M.street.length) { status(`${sym} has no forward street estimates to model.`, true); return; }

  overrides = restore(sym);
  drivers = seedDrivers(M, M.street);
  applyCurated();     // considered defaults sit between street seed and your edits
  applyOverrides();   // your edits always win
  seedAssumptions();
  setAsOf(M.history[M.history.length - 1].date, "LAST FY");
  document.getElementById("model").hidden = false;
  loadNotes();
  history.replaceState(null, "", `?t=${sym}`);
  render();
}

const restore = (sym) => {
  try { return JSON.parse(localStorage.getItem(STORE(sym)) || "{}"); } catch { return {}; }
};
const persist = () => {
  try { localStorage.setItem(STORE(M.symbol), JSON.stringify(overrides)); } catch {}
};

/* Curated per-ticker views layer on top of the street/history seed but BELOW
   user overrides, so "Reset overrides" returns to raw consensus rather than to
   someone else's opinion. Absent tickers simply keep the seed. */
function applyCurated() {
  const t = CURATED?.tickers?.[M.symbol];
  if (!t?.drivers) return;
  for (const [key, series] of Object.entries(t.drivers)) {
    series.forEach((v, i) => { if (drivers[i] && v != null) drivers[i][key] = v; });
  }
}

function applyOverrides() {
  for (const [k, v] of Object.entries(overrides)) {
    const [key, ci] = k.split(":");
    if (drivers[+ci] && v != null) drivers[+ci][key] = v;
  }
}

function seedAssumptions() {
  const hist = historyRows(M);
  const last = hist[hist.length - 1];
  const s = M.seed || {};
  assumptions = {
    beta: M.beta ?? s.beta ?? 1,
    riskFree: M.riskFree ?? s.riskFree ?? 0.045,
    marketRiskPremium: s.marketRiskPremium ?? 0.047,
    costOfDebt: s.costOfDebt ?? 0.05,
    taxRate: drivers[0]?.taxRate ?? 0.21,
    marketCap: M.marketCap,
    totalDebt: last.debt,
    // Net debt uses cash AND short-term investments: FMP's own netDebt field
    // ignores STI, which understates cash by 55.9bn for MSFT.
    netDebt: last.debt - last.cashAndSTI,
    shares: last.shares,
    g: s.longTermGrowth ?? 0.025,
    exitMultiple: null,
    method: "perpetuity",
    ...(CURATED?.tickers?.[M.symbol]?.dcf || {}),
    ...(overrides.__assumptions || {}),
  };
}

/* ---------------- render ---------------- */

function render() {
  const hist = historyRows(M);
  const proj = project(M, drivers, { interestOnOpening: interestMode === "open" });
  const cols = [...hist.map((h) => ({ label: h.label, actual: true })),
                ...proj.years.map((y) => ({ label: y.label, actual: false }))];
  const values = [...hist, ...proj.years];
  const nHist = hist.length;

  summary(hist, proj);
  driverGrid(cols, nHist);
  statementGrids(cols, values);
  balanceNote(proj);
  dcf(proj);
  thesis();
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function thesis() {
  const t = CURATED?.tickers?.[M.symbol];
  const panel = document.getElementById("thesis-panel");
  const host = document.getElementById("thesis");
  if (!t) { panel.hidden = true; return; }
  panel.hidden = false;
  const hv = CURATED.house_view || {};
  host.innerHTML =
    `<p><strong>${esc(t.thesis)}</strong></p>` +
    (t.flags?.length
      ? `<p class="disclosure">${t.flags.map(esc).join(" ")}</p>` : "") +
    t.rationale.map(([h, body]) => `<h3>${esc(h)}</h3><p>${esc(body)}</p>`).join("") +
    (t.risks?.length
      ? `<h3>What would make this wrong</h3><ul>${t.risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "") +
    `<h3>How to read this</h3><p class="disclosure">${esc(hv.read_it_this_way || "")}</p>` +
    `<h3>House conventions</h3><p>${esc(hv.terminal_growth || "")} ${esc(hv.cyclicals || "")} ${esc(hv.fade || "")}</p>` +
    `<h3>What this is not</h3><p>${esc(hv.what_this_is_not || "")}</p>` +
    `<p class="note">${esc(CURATED.note || "")}</p>`;
}

/* Free-text notes, per ticker, saved on a debounce. */
let notesTimer = null;
function wireNotes() {
  const box = document.getElementById("notes"), state = document.getElementById("notes-state");
  box.addEventListener("input", () => {
    clearTimeout(notesTimer);
    state.textContent = "Saving…";
    notesTimer = setTimeout(() => {
      try {
        localStorage.setItem(`qp-notes-${M.symbol}`, box.value);
        state.textContent = `Saved ${new Date().toLocaleTimeString()}`;
      } catch { state.textContent = "Could not save (private browsing?)"; }
    }, 500);
  });
}
function loadNotes() {
  const box = document.getElementById("notes");
  try { box.value = localStorage.getItem(`qp-notes-${M.symbol}`) || ""; } catch { box.value = ""; }
  document.getElementById("notes-state").textContent = "Saved in this browser, per ticker.";
}

function summary(hist, proj) {
  const last = hist[hist.length - 1], end = proj.years[proj.years.length - 1];
  const cagr = Math.pow(end.revenue / last.revenue, 1 / proj.years.length) - 1;
  renderStats("summary", [
    { label: "Company", value: M.symbol, delta: M.name?.slice(0, 28) },
    { label: "Price", value: M.price != null ? "$" + fmtNum(M.price) : "—",
      delta: `mkt cap ${fmtMoney(M.marketCap)}` },
    { label: `Revenue CAGR (${proj.years.length}y)`, value: fmtPct(cagr),
      delta: "street-driven", tone: cagr > 0 ? "up" : "down" },
    { label: "Street coverage", value: `${M.street.length}y`,
      delta: `${M.street[0]?.numAnalystsRevenue ?? "?"}→${M.street[M.street.length - 1]?.numAnalystsRevenue ?? "?"} analysts` },
    { label: "Interest solve", value: proj.converged ? `${proj.passes} passes` : "no converge",
      tone: proj.converged ? "" : "down",
      delta: interestMode === "open" ? "opening balance" : "average balance" },
  ]);
}

function driverGrid(cols, nHist) {
  const rows = DRIVER_DEFS.map((d) => ({
    key: d.key, label: d.label, editable: true, kind: d.kind,
    fmt: d.kind === "pct" ? FORMATS.pct : FORMATS.days,
    source: d.key === "revenueGrowth" ? "street" : "seeded",
  }));
  // Drivers only exist for projected columns; history columns show blanks.
  const values = cols.map((c, i) => (i < nHist ? {} : drivers[i - nHist] || {}));
  renderGrid(document.getElementById("g-drivers"), {
    rows, cols, values, editable: true, overrides, overrideOffset: nHist,
    onEdit: (key, ci, val) => {
      const projIdx = ci - nHist;
      if (projIdx < 0) return;
      const k = `${key}:${projIdx}`;
      if (val == null) { delete overrides[k]; drivers = seedDrivers(M, M.street); applyOverrides(); }
      else { overrides[k] = val; drivers[projIdx][key] = val; }
      persist();
      render();
    },
  });
}

const R = (key, label, o = {}) => ({ key, label, fmt: FORMATS.money, ...o });

function statementGrids(cols, values) {
  renderGrid(document.getElementById("g-income"), { rows: [
    R("revenue", "Revenue", { bold: true }),
    R("cogs", "Cost of revenue", { indent: true }),
    R("grossProfit", "Gross profit", { rule: true }),
    R("opex", "Operating expenses", { indent: true }),
    R("ebit", "Operating income (EBIT)", { bold: true, rule: true }),
    R("da", "D&A", { indent: true }),
    R("ebitda", "EBITDA", { hint: "As reported: pretax + interest + D&A, not EBIT + D&A" }),
    R("interestExpense", "Interest expense", { indent: true }),
    R("ebt", "Pre-tax income", { rule: true }),
    R("tax", "Tax", { indent: true }),
    R("netIncome", "Net income", { bold: true, rule: true }),
  ], cols, values, editable: false });

  renderGrid(document.getElementById("g-cash"), { rows: [
    R("netIncome", "Net income"),
    R("da", "D&A", { indent: true }),
    R("changeInNwc", "Change in working capital", { indent: true }),
    R("cfo", "Cash from operations", { bold: true, rule: true }),
    R("capex", "Capital expenditure", { indent: true }),
    R("fcf", "Free cash flow", { bold: true, rule: true }),
    R("dividends", "Dividends", { indent: true }),
    R("buybacks", "Buybacks", { indent: true }),
    R("debtRepaid", "Debt repaid", { indent: true }),
    R("revolverDraw", "Revolver draw", { indent: true, hint: "Plug: funds any shortfall below the minimum cash balance" }),
    R("netChangeInCash", "Net change in cash", { bold: true, rule: true }),
  ], cols, values, editable: false });

  renderGrid(document.getElementById("g-balance"), { rows: [
    R("cash", "Cash"),
    R("receivables", "Receivables", { indent: true }),
    R("inventory", "Inventory", { indent: true }),
    R("ppe", "PP&E, net", { indent: true }),
    R("totalAssets", "Total assets", { bold: true, rule: true }),
    R("payables", "Payables", { indent: true }),
    R("debt", "Debt", { indent: true }),
    R("revolver", "Revolver", { indent: true }),
    R("totalLiabilities", "Total liabilities", { rule: true }),
    R("equity", "Equity", { bold: true }),
    R("minorityInterest", "Minority interest", { indent: true }),
    R("check", "Check: A − (L + E)", { rule: true, fmt: (v) => (Math.abs(v) < 1 ? "0" : FORMATS.money(v)) }),
  ], cols, values, editable: false });
}

function balanceNote(proj) {
  const worst = Math.max(...proj.years.map((y) => Math.abs(y.check) / Math.max(y.totalAssets, 1)));
  const n = document.getElementById("balance-check");
  const ok = worst < 1e-9;
  const res = proj.openingResidual;
  // Flag inherited vendor rounding separately from model drift — they are
  // different problems and only one of them is ours.
  const inherited = Math.abs(res) > 1
    ? ` Opening balance sheet as reported was out by ${fmtMoney(res)}; absorbed as a reconciling item.`
    : "";
  n.textContent = (ok ? "Balances in every projected year." :
    `Out of balance by ${(worst * 100).toExponential(1)}%`) + inherited;
  n.className = ok ? "note" : "note disclosure";
}

/* ---------------- DCF ---------------- */

function dcf(proj) {
  const A = { ...assumptions };
  const v = valuate({ years: proj.years, assumptions: A });

  const ctl = document.getElementById("dcf-controls");
  ctl.innerHTML = "";
  const field = (key, label, kind = "pct") => {
    const inp = el("input", { class: "input", style: "width:82px", type: "text",
      value: kind === "pct" ? (A[key] * 100).toFixed(2) : String(A[key] ?? ""),
      "aria-label": label });
    inp.addEventListener("change", () => {
      const n = parseFloat(inp.value.replace(/[%,\s]/g, ""));
      if (isFinite(n)) {
        assumptions[key] = kind === "pct" ? n / 100 : n;
        overrides.__assumptions = { ...(overrides.__assumptions || {}), [key]: assumptions[key] };
        persist(); render();
      }
    });
    return el("span", { class: "key" }, [el("span", { class: "clabel", text: label }), inp]);
  };
  ctl.append(field("beta", "Beta", "n"), field("riskFree", "Risk-free"),
             field("marketRiskPremium", "ERP"), field("costOfDebt", "Cost of debt"),
             field("g", "Terminal g"));

  const ig = impliedGrowth({ years: proj.years, assumptions: A, price: M.price });
  renderStats("dcf-out", [
    { label: "WACC", value: fmtPct(v.wacc, 2),
      delta: `ke ${fmtPct(v.costOfEquity, 1)} · kd ${fmtPct(v.afterTaxCostOfDebt, 1)}` },
    { label: "Enterprise value", value: fmtMoney(v.enterpriseValue) },
    { label: "Equity value", value: fmtMoney(v.equityValue) },
    { label: "Value per share", value: v.perShare == null ? "—" : "$" + fmtNum(v.perShare),
      tone: v.perShare > M.price ? "up" : "down",
      delta: M.price ? `${(((v.perShare / M.price) - 1) * 100).toFixed(0)}% vs market` : null },
    { label: "Terminal share of EV", value: fmtPct(v.terminalShare, 0),
      delta: v.terminalShare > 0.75 ? "terminal-dominated" : null,
      tone: v.terminalShare > 0.75 ? "down" : "" },
    // The single most useful number on the page: the terminal growth today's
    // price implies, against the one being assumed. A large gap says the
    // disagreement is about the terminal assumption, not about the business.
    { label: "Market implies g", value: ig == null ? "out of range" : fmtPct(ig, 2),
      delta: ig == null ? "price outside model range" : `assuming ${fmtPct(A.g, 2)}`,
      tone: ig == null ? "" : ig > A.g ? "down" : "up" },
  ]);

  const cols = proj.years.map((y) => ({ label: y.label, actual: false }));
  renderGrid(document.getElementById("g-dcf"), {
    rows: [R("ufcf", "Unlevered FCF"), R("discount", "Discount factor", { fmt: (x) => x.toFixed(3) }),
           R("pv", "Present value", { bold: true })],
    cols, values: v.flows, editable: false,
  });

  const waccs = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => v.wacc + d);
  const gs = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => A.g + d);
  const grid = sensitivity({ years: proj.years, assumptions: A, waccs, growths: gs });
  renderGrid(document.getElementById("g-sens"), {
    rows: gs.map((g, gi) => ({ key: `g${gi}`, label: `g ${fmtPct(g, 2)}`,
      fmt: (x) => (x == null ? "n/a" : "$" + x.toFixed(0)) })),
    cols: waccs.map((w) => ({ label: fmtPct(w, 1), actual: false })),
    values: waccs.map((_, wi) => Object.fromEntries(gs.map((_, gi) => [`g${gi}`, grid[gi][wi]]))),
    editable: false,
  });

  const ver = verifyAgainstFmp(M.fmpDcf);
  document.getElementById("dcf-verify").textContent = ver
    ? `cross-check vs FMP: ${(ver.perShare.err * 100).toFixed(2)}% on ${ver.horizon}y` : "";
  document.getElementById("dcf-note").textContent =
    `FCFF = EBIT(1−t) + D&A − capex − ΔNWC, discounted ${proj.years.length} years at WACC ` +
    `${fmtPct(v.wacc, 2)}, terminal value by perpetuity growth at ${fmtPct(A.g, 2)} ` +
    `(implies ${v.impliedExitMultiple?.toFixed(1)}x terminal EBITDA). ` +
    `Net debt uses cash and short-term investments. ` +
    (ig != null ? `Reverse DCF: today's price implies terminal growth of ${fmtPct(ig, 2)}. ` : "") +
    `Projections are assumptions, not forecasts.`;
}

/* ---------------- key + io ---------------- */

function promptKey() {
  const k = window.prompt(
    "FMP API key — stored in this browser only, never sent anywhere but FMP.\n" +
    "Leave blank to clear.", FMP.getKey());
  if (k === null) return;
  FMP.setKey(k);
  status(k ? "Key saved. Try the ticker again." : "Key cleared.");
}

(async function init() {
  renderShell();
  CURATED = await loadJSON("data/model-assumptions.json").catch(() => null);
  registerCommands([]);
  document.getElementById("load").addEventListener("click",
    () => load(document.getElementById("ticker").value));
  document.getElementById("ticker").addEventListener("keydown",
    (e) => { if (e.key === "Enter") load(e.target.value); });
  document.getElementById("keybtn").addEventListener("click", promptKey);
  document.getElementById("reset").addEventListener("click", () => {
    if (!M) return;
    overrides = {}; persist();
    drivers = seedDrivers(M, M.street); seedAssumptions(); render();
    status("Overrides cleared; back to street and seeded defaults.");
  });
  document.getElementById("export").addEventListener("click", () => {
    if (!M) return;
    const blob = new Blob([JSON.stringify({ symbol: M.symbol, overrides }, null, 1)],
                          { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `${M.symbol}-model.json` });
    document.body.appendChild(a); a.click(); a.remove();
  });
  document.getElementById("import").addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      overrides = d.overrides || {};
      if (d.symbol && d.symbol !== M?.symbol) { document.getElementById("ticker").value = d.symbol; await load(d.symbol); }
      else { applyOverrides(); seedAssumptions(); persist(); render(); }
      status(`Imported ${d.symbol || ""} overrides.`);
    } catch (err) { status(`Import failed: ${err.message}`, true); }
  });
  document.getElementById("interest-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle("active", c === b));
    interestMode = b.dataset.v;
    if (M) render();
  });

  wireNotes();
  const t = new URLSearchParams(location.search).get("t");
  if (t) { document.getElementById("ticker").value = t; load(t); }
})();
