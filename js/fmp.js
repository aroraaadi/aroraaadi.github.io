/* Browser-side FMP client.

   The site is static on GitHub Pages, so there is no server to hold a key. FMP
   sends `access-control-allow-origin: *` on every response (verified from the
   Pages origin), so the browser may call it directly. The key lives in
   localStorage and is never committed.

   Semantics mirror the proven Python client in
   `Financial Modeling Prep/fmp_client.py`:
     - base is /stable; the legacy /api/v3 endpoints 403 for post-2025-08 keys
     - `limit` defaults to 5 if not passed, so always pass one explicitly
     - an unknown symbol returns HTTP 200 with [], NOT an error
     - retry 429/5xx with linear backoff */

const API = "https://financialmodelingprep.com/stable";
const KEY_STORE = "qp-fmp-key";

export class FMPError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export const getKey = () => {
  try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; }
};
export const setKey = (k) => {
  try { k ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE); }
  catch { /* private mode — the session still works, it just won't persist */ }
};
export const hasKey = () => !!getKey();

export async function get(endpoint, params = {}, { retries = 3 } = {}) {
  const key = getKey();
  if (!key) throw new FMPError("No API key set.", 0);
  const q = new URLSearchParams({ ...params, apikey: key });
  const url = `${API}/${endpoint}?${q}`;

  let last;
  for (let attempt = 0; attempt < retries; attempt++) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      last = new FMPError(`network error on ${endpoint}: ${e.message}`, 0);
      if (attempt < retries - 1) { await sleep(600 * (attempt + 1)); continue; }
      throw last;
    }
    if (res.ok) {
      const data = await res.json();
      if (data && data["Error Message"]) throw new FMPError(data["Error Message"], res.status);
      return data;
    }
    if (res.status === 401 || res.status === 403) {
      throw new FMPError("FMP rejected the API key (401/403). Check it in Settings.", res.status);
    }
    last = new FMPError(`HTTP ${res.status} on ${endpoint}`, res.status);
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < retries - 1) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    throw last;
  }
  throw last;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Everything one ticker's model needs, in parallel. */
export async function fetchTicker(symbol) {
  const s = symbol.trim().toUpperCase();
  const [profile, income, balance, cash, estimates, drivers, treasury] = await Promise.all([
    get("profile", { symbol: s }),
    get("income-statement", { symbol: s, period: "annual", limit: 5 }),
    get("balance-sheet-statement", { symbol: s, period: "annual", limit: 5 }),
    get("cash-flow-statement", { symbol: s, period: "annual", limit: 5 }),
    get("analyst-estimates", { symbol: s, period: "annual", limit: 20 }),
    get("custom-discounted-cash-flow", { symbol: s }).catch(() => []),
    get("treasury-rates", {}).catch(() => []),
  ]);
  if (!profile?.length) throw new FMPError(`No such symbol: ${s}`, 404);
  if (!income?.length) throw new FMPError(`${s} has no reported statements (a fund or index?)`, 404);
  return normalize({ symbol: s, profile: profile[0], income, balance, cash, estimates, drivers, treasury });
}

/* ------------------------------------------------------------------ *
 * Normalisation — where the vendor's sharp edges get filed off.
 * ------------------------------------------------------------------ */

export function normalize({ symbol, profile, income, balance, cash, estimates, drivers, treasury }) {
  const hist = buildHistory(income, balance, cash);
  // Anything after the last reported fiscal year is a projection.
  const lastActual = hist.length ? hist[hist.length - 1].fiscalYear : null;
  return {
    symbol,
    name: profile.companyName,
    currency: profile.currency,
    reportingCurrency: income[0]?.reportedCurrency || profile.currency,
    exchange: profile.exchange,
    sector: profile.sector,
    price: profile.price,
    marketCap: profile.marketCap,
    beta: profile.beta,
    history: hist,
    street: annualEstimates(estimates, hist),
    seed: driverSeed(drivers, lastActual),
    riskFree: riskFreeRate(treasury),
    fmpDcf: fmpDcfReference(drivers, lastActual),
  };
}

function buildHistory(income, balance, cash) {
  const byDate = new Map();
  const put = (rows, key) => {
    for (const r of rows || []) {
      if (r.period !== "FY") continue;
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, fiscalYear: r.fiscalYear });
      byDate.get(r.date)[key] = r;
    }
  };
  put(income, "income"); put(balance, "balance"); put(cash, "cash");
  return [...byDate.values()]
    .filter((y) => y.income && y.balance && y.cash)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-3);
}

/* Street estimates: annual rows only.

   DEFECT: FMP's analyst-estimates response carries no `period` field, so annual
   and quarterly rows for the same fiscal year end land on the SAME date and are
   indistinguishable by schema. Two discriminators, both required:
     1. the row's month-day must match the company's fiscal year end
     2. among collisions, the annual row has materially more contributing
        analysts (MSFT FY2028: 38 analysts / 466bn annual vs 11 / 127bn Q4)
   Taking the max by revenue would also work but breaks for loss-making or
   shrinking names, so analyst count is the safer key. */
function annualEstimates(estimates, history) {
  if (!estimates?.length || !history.length) return [];
  const fyEnd = history[history.length - 1].date.slice(5); // "MM-DD"
  const lastActual = history[history.length - 1].date;

  const byDate = new Map();
  for (const e of estimates) {
    if (e.date.slice(5) !== fyEnd) continue;      // discriminator 1
    if (e.date <= lastActual) continue;           // forward only
    const prev = byDate.get(e.date);
    if (!prev || (e.numAnalystsRevenue || 0) > (prev.numAnalystsRevenue || 0)) {
      byDate.set(e.date, e);                      // discriminator 2
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/* FMP's projected driver set seeds the lines street does not cover.

   DEFECT: this endpoint returns ~10 rows MIXING historical actuals with
   projections, and the DCF discounts only the projected ones — getting the
   split wrong moves the valuation ~30%.

   A constant-growth heuristic is NOT sufficient. MSFT holds growth flat across
   the forecast (13.82% x5), but AAPL and NEE fade it (5.87, 5.36, 4.90, 4.47,
   4.09), so no two consecutive rows match and the heuristic finds only the last
   one — which silently collapsed the horizon to 1 year and threw the valuation
   off by 11-25%. Split on the last REPORTED fiscal year instead, which is
   unambiguous and always available from the income statement. */
function projectedRows(drivers, lastActualYear) {
  if (!drivers?.length) return [];
  const rows = [...drivers].sort((a, b) => a.year - b.year);
  if (lastActualYear != null) return rows.filter((r) => r.year > lastActualYear);
  return rows.slice(-5);   // no history to anchor on: FMP's usual horizon
}

function driverSeed(drivers, lastActualYear) {
  const proj = projectedRows(drivers, lastActualYear);
  if (!proj.length) return null;
  const r = proj[0];
  const pct = (v) => (v == null ? null : v / 100);
  return {
    source: "fmp-model",
    revenueGrowth: pct(r.revenuePercentage),
    ebitdaMargin: pct(r.ebitdaPercentage),
    ebitMargin: pct(r.ebitPercentage),
    daPctRevenue: pct(r.depreciationPercentage),
    capexPctRevenue: Math.abs(pct(r.capitalExpenditurePercentage) ?? 0) || null,
    receivablesPctRevenue: pct(r.receivablesPercentage),
    inventoryPctRevenue: pct(r.inventoriesPercentage),
    payablesPctRevenue: pct(r.payablePercentage),
    taxRate: pct(r.taxRate),
    beta: r.beta,
    riskFree: pct(r.riskFreeRate),
    marketRiskPremium: pct(r.marketRiskPremium),
    costOfDebt: pct(r.costofDebt),
    longTermGrowth: pct(r.longTermGrowthRate),
    horizon: proj.length,
  };
}

/* FMP's own valuation, kept purely as a cross-check target for our DCF. */
function fmpDcfReference(drivers, lastActualYear) {
  const proj = projectedRows(drivers, lastActualYear);
  if (!proj.length) return null;
  const last = proj[proj.length - 1];
  return {
    horizon: proj.length,
    wacc: last.wacc / 100,
    longTermGrowth: last.longTermGrowthRate / 100,
    sumPvUfcf: last.sumPvUfcf,
    terminalValue: last.terminalValue,
    presentTerminalValue: last.presentTerminalValue,
    enterpriseValue: last.enterpriseValue,
    netDebt: last.netDebt,
    equityValue: last.equityValue,
    perShare: last.equityValuePerShare,
    shares: last.dilutedSharesOutstanding,
    ufcf: proj.map((r) => ({ year: r.year, ufcf: r.ufcf })),
  };
}

function riskFreeRate(treasury) {
  const r = treasury?.[0];
  return r?.year10 != null ? r.year10 / 100 : 0.045;
}
