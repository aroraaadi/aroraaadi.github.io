/* Three-statement projection engine. Pure — no DOM, no fetch — so it can be
   unit-tested and reasoned about on its own.

   The statements are genuinely linked:
     net income   -> cash flow top line, and retained earnings on the BS
     D&A          -> added back in CFO, and reduces net PP&E
     capex        -> CF investing, and increases net PP&E
     DSO/DIO/DPO  -> working-capital balances on the BS, whose CHANGE is the
                     working-capital line in CFO
     ending cash  -> BS cash
     debt issuance-> CF financing and the BS debt balance

   Two things make this non-trivial and are handled explicitly:

   1. CIRCULARITY. Interest expense depends on the average debt balance, which
      depends on the revolver draw, which depends on the cash shortfall, which
      depends on interest. Rather than pretend the model is acyclic, `project`
      iterates to convergence (default tol 1e-6, cap 50 passes) and reports how
      many passes it took. `interestOnOpening: true` breaks the loop for anyone
      who wants a strictly feed-forward model.

   2. THE PLUG. Surplus cash accumulates; a shortfall below the minimum cash
      balance draws a revolver. Without this the balance sheet cannot tie in a
      projected year. `checks[]` exposes Assets - (Liabilities + Equity) per
      year so an imbalance is visible rather than silently absorbed. */

export const DRIVER_DEFS = [
  { key: "revenueGrowth",    label: "Revenue growth",        kind: "pct",  group: "Income" },
  { key: "grossMargin",      label: "Gross margin",          kind: "pct",  group: "Income" },
  { key: "opexPctRevenue",   label: "Opex % of revenue",     kind: "pct",  group: "Income" },
  { key: "daPctRevenue",     label: "D&A % of revenue",      kind: "pct",  group: "Income" },
  { key: "taxRate",          label: "Tax rate",              kind: "pct",  group: "Income" },
  { key: "interestRate",     label: "Interest rate on debt", kind: "pct",  group: "Income" },
  { key: "capexPctRevenue",  label: "Capex % of revenue",    kind: "pct",  group: "Cash flow" },
  { key: "dso",              label: "Receivable days (DSO)", kind: "days", group: "Working capital" },
  { key: "dio",              label: "Inventory days (DIO)",  kind: "days", group: "Working capital" },
  { key: "dpo",              label: "Payable days (DPO)",    kind: "days", group: "Working capital" },
  { key: "dividendPayout",   label: "Dividend payout",       kind: "pct",  group: "Financing" },
  { key: "buybackPctFcf",    label: "Buyback % of FCF",      kind: "pct",  group: "Financing" },
  { key: "debtRepayPct",     label: "Debt repaid",           kind: "pct",  group: "Financing" },
];

const num = (x) => (typeof x === "number" && isFinite(x) ? x : 0);
const safeDiv = (a, b) => (num(b) === 0 ? 0 : num(a) / num(b));

/* ---------------------------------------------------------------- *
 * Seeding
 * ---------------------------------------------------------------- */

/* Derive a starting driver set from reported history, then let the street and
   FMP's projected drivers override where they have an opinion. History is the
   fallback precisely because it is the only thing that is always present. */
export function seedDrivers(model, years) {
  const h = model.history;
  const last = h[h.length - 1];
  const prev = h.length > 1 ? h[h.length - 2] : last;
  const i = last.income, b = last.balance, c = last.cash;
  const rev = num(i.revenue);

  const histGrowth = safeDiv(rev - num(prev.income.revenue), num(prev.income.revenue));
  const cogs = num(i.costOfRevenue);
  const seed = model.seed || {};

  const base = {
    revenueGrowth: seed.revenueGrowth ?? histGrowth,
    grossMargin: safeDiv(rev - cogs, rev),
    opexPctRevenue: safeDiv(num(i.operatingExpenses), rev),
    daPctRevenue: seed.daPctRevenue ?? safeDiv(num(c.depreciationAndAmortization), rev),
    taxRate: seed.taxRate ?? clamp(safeDiv(num(i.incomeTaxExpense), num(i.incomeBeforeTax)), 0, 0.45),
    interestRate: clamp(safeDiv(num(i.interestExpense), num(b.totalDebt)), 0, 0.25),
    capexPctRevenue: seed.capexPctRevenue ?? Math.abs(safeDiv(num(c.capitalExpenditure), rev)),
    dso: safeDiv(num(b.netReceivables), rev) * 365,
    dio: cogs > 0 ? safeDiv(num(b.inventory), cogs) * 365 : 0,
    dpo: cogs > 0 ? safeDiv(num(b.accountPayables), cogs) * 365 : 0,
    dividendPayout: clamp(safeDiv(Math.abs(num(c.commonDividendsPaid)), num(i.netIncome)), 0, 1),
    buybackPctFcf: clamp(safeDiv(Math.abs(num(c.commonStockRepurchased)), Math.max(num(c.freeCashFlow), 1)), 0, 1),
    debtRepayPct: 0,
  };

  // Street revenue growth wins for the years it covers — it is the actual
  // consensus, where FMP's driver set is only FMP's own model.
  return years.map((y, idx) => {
    const row = { ...base };
    const st = model.street?.[idx];
    if (st?.revenueAvg) {
      const priorRev = idx === 0 ? rev : num(model.street[idx - 1]?.revenueAvg);
      if (priorRev) row.revenueGrowth = safeDiv(num(st.revenueAvg) - priorRev, priorRev);
    }
    return row;
  });
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, num(x)));

/* ---------------------------------------------------------------- *
 * Projection
 * ---------------------------------------------------------------- */

export function project(model, drivers, opts = {}) {
  const { interestOnOpening = false, minCash = null, tol = 1e-6, maxPasses = 50 } = opts;
  const h = model.history;
  const last = h[h.length - 1];
  const openingCash = num(last.balance.cashAndCashEquivalents);
  const floor = minCash == null ? openingCash * 0.5 : minCash;

  let interestGuess = drivers.map(() => num(last.income.interestExpense));
  let out = null, passes = 0, delta = Infinity;

  // With interest on the opening balance the model is acyclic by construction,
  // so a single pass is the answer — iterating would only chase impliedInterest,
  // which that mode deliberately does not use.
  if (interestOnOpening) {
    out = onePass(model, drivers, interestGuess, { interestOnOpening, floor });
    return { ...out, converged: true, passes: 1, residual: 0 };
  }

  for (passes = 1; passes <= maxPasses; passes++) {
    out = onePass(model, drivers, interestGuess, { interestOnOpening, floor });
    // Compare the guess against the interest IMPLIED by the debt balances that
    // guess produced — not against itself, which would converge trivially and
    // leave interest pinned at its opening value forever.
    const implied = out.years.map((y) => y.impliedInterest);
    delta = Math.max(...implied.map((v, i) =>
      Math.abs(v - interestGuess[i]) / Math.max(Math.abs(v), 1)));
    if (delta < tol) break;
    // Damped update: the revolver makes the map non-smooth when a draw switches
    // on, and undamped iteration can oscillate between draw/no-draw.
    interestGuess = implied.map((v, i) => 0.5 * v + 0.5 * interestGuess[i]);
  }
  out.converged = delta < tol;
  out.passes = passes;
  out.residual = delta;
  return out;
}

function onePass(model, drivers, interestGuess, { interestOnOpening, floor }) {
  const h = model.history;
  const last = h[h.length - 1];
  let prev = {
    revenue: num(last.income.revenue),
    cash: num(last.balance.cashAndCashEquivalents),
    ppe: num(last.balance.propertyPlantEquipmentNet),
    debt: num(last.balance.totalDebt),
    revolver: 0,
    equity: num(last.balance.totalStockholdersEquity),
    receivables: num(last.balance.netReceivables),
    inventory: num(last.balance.inventory),
    payables: num(last.balance.accountPayables),
    otherAssets: num(last.balance.totalAssets)
      - num(last.balance.cashAndCashEquivalents)
      - num(last.balance.netReceivables)
      - num(last.balance.inventory)
      - num(last.balance.propertyPlantEquipmentNet),
    otherLiabilities: num(last.balance.totalLiabilities)
      - num(last.balance.accountPayables)
      - num(last.balance.totalDebt),
    // FMP reports A = L + E + minorityInterest, i.e. NCI sits outside BOTH
    // totalLiabilities and totalStockholdersEquity. Dropping it broke the
    // identity by exactly its size on the 175 of 555 rows that carry one
    // (BE: 24.3m on 4.40bn of assets = 0.55%). Held flat through the forecast;
    // projecting NCI would need a subsidiary-level forecast we do not have.
    minorityInterest: num(last.balance.minorityInterest),
  };

  // The vendor's own reported balance sheet does not always tie to the cent:
  // GE is out by $2,000,000 on $130.2bn (0.0015%), XNDU by $1. Absorb that
  // opening residual explicitly so the PROJECTION ties, rather than letting
  // inherited rounding masquerade as model drift. Reported as openingResidual.
  const openingResidual = num(last.balance.totalAssets)
    - (num(last.balance.totalLiabilities) + num(last.balance.totalStockholdersEquity)
       + num(last.balance.minorityInterest));
  prev.otherLiabilities += openingResidual;

  const years = [];
  drivers.forEach((d, idx) => {
    const revenue = prev.revenue * (1 + num(d.revenueGrowth));
    const grossProfit = revenue * num(d.grossMargin);
    const cogs = revenue - grossProfit;
    const opex = revenue * num(d.opexPctRevenue);
    const da = revenue * num(d.daPctRevenue);
    const ebit = grossProfit - opex;
    const ebitda = ebit + da;

    const openDebt = prev.debt + prev.revolver;
    const interestExpense = interestOnOpening
      ? openDebt * num(d.interestRate)
      : num(interestGuess[idx]);

    const ebt = ebit - interestExpense;
    const tax = Math.max(0, ebt) * num(d.taxRate);
    const netIncome = ebt - tax;

    // Working capital from days ratios; its CHANGE is the CFO line.
    const receivables = (num(d.dso) / 365) * revenue;
    const inventory = (num(d.dio) / 365) * cogs;
    const payables = (num(d.dpo) / 365) * cogs;
    const nwc = receivables + inventory - payables;
    const prevNwc = prev.receivables + prev.inventory - prev.payables;
    const changeInNwc = nwc - prevNwc;

    const cfo = netIncome + da - changeInNwc;
    const capex = revenue * num(d.capexPctRevenue);
    const cfi = -capex;
    const fcf = cfo - capex;

    const dividends = Math.max(0, netIncome) * num(d.dividendPayout);
    const buybacks = Math.max(0, fcf) * num(d.buybackPctFcf);
    const debtRepaid = prev.debt * num(d.debtRepayPct);

    const preFinancingCash = prev.cash + cfo + cfi - dividends - buybacks - debtRepaid;

    // Plug: draw a revolver to hold the minimum cash balance, otherwise sweep
    // surplus into cash. Repay any outstanding revolver before accumulating.
    let revolver = prev.revolver, cash = preFinancingCash;
    if (cash < floor) {
      revolver += floor - cash;
      cash = floor;
    } else if (revolver > 0) {
      const repay = Math.min(revolver, cash - floor);
      revolver -= repay;
      cash -= repay;
    }
    const revolverDraw = revolver - prev.revolver;
    const cff = -dividends - buybacks - debtRepaid + revolverDraw;

    const ppe = prev.ppe + capex - da;
    const debt = prev.debt - debtRepaid;
    // Interest implied by the average of opening and closing interest-bearing
    // debt (term debt plus revolver). This is what the next iteration matches
    // the guess against.
    const impliedInterest = ((openDebt + debt + revolver) / 2) * num(d.interestRate);
    const equity = prev.equity + netIncome - dividends - buybacks;

    const totalAssets = cash + receivables + inventory + ppe + prev.otherAssets;
    const totalLiabilities = payables + debt + revolver + prev.otherLiabilities;
    const minorityInterest = prev.minorityInterest;
    const check = totalAssets - (totalLiabilities + equity + minorityInterest);

    years.push({
      year: model.projYears?.[idx] ?? idx + 1,
      label: model.projLabels?.[idx] ?? `FY+${idx + 1}`,
      revenue, cogs, grossProfit, opex, ebit, da, ebitda,
      interestExpense, impliedInterest, ebt, tax, netIncome,
      cfo, capex, cfi, fcf, changeInNwc, dividends, buybacks, debtRepaid,
      revolverDraw, cff, netChangeInCash: cash - prev.cash,
      cash, receivables, inventory, ppe, otherAssets: prev.otherAssets,
      payables, debt, revolver, otherLiabilities: prev.otherLiabilities,
      equity, minorityInterest, totalAssets, totalLiabilities, check,
      nwc,
    });

    prev = {
      revenue, cash, ppe, debt, revolver, equity,
      receivables, inventory, payables,
      otherAssets: prev.otherAssets, otherLiabilities: prev.otherLiabilities,
      minorityInterest: prev.minorityInterest,
    };
  });

  return { years, checks: years.map((y) => y.check), openingResidual };
}

/* Historical rows in the same shape as projected ones, so the grid renders one
   continuous series. Note `ebitda` is taken as reported — FMP's is EBT-based
   (pretax + interest + D&A), NOT operatingIncome + D&A. For BE those differ by
   6x, so recomputing it here would silently disagree with the street figures
   that are quoted on the same basis. */
export function historyRows(model) {
  return model.history.map((y) => {
    const i = y.income, b = y.balance, c = y.cash;
    return {
      year: y.fiscalYear, label: `FY${String(y.fiscalYear).slice(-2)}`, actual: true,
      revenue: num(i.revenue), cogs: num(i.costOfRevenue), grossProfit: num(i.grossProfit),
      opex: num(i.operatingExpenses), ebit: num(i.operatingIncome),
      da: num(c.depreciationAndAmortization), ebitda: num(i.ebitda),
      interestExpense: num(i.interestExpense), ebt: num(i.incomeBeforeTax),
      tax: num(i.incomeTaxExpense), netIncome: num(i.netIncome),
      cfo: num(c.netCashProvidedByOperatingActivities),
      capex: Math.abs(num(c.capitalExpenditure)),
      cfi: num(c.netCashProvidedByInvestingActivities),
      cff: num(c.netCashProvidedByFinancingActivities),
      fcf: num(c.freeCashFlow), changeInNwc: -num(c.changeInWorkingCapital),
      dividends: Math.abs(num(c.commonDividendsPaid)),
      buybacks: Math.abs(num(c.commonStockRepurchased)),
      netChangeInCash: num(c.netChangeInCash),
      cash: num(b.cashAndCashEquivalents), receivables: num(b.netReceivables),
      inventory: num(b.inventory), ppe: num(b.propertyPlantEquipmentNet),
      payables: num(b.accountPayables), debt: num(b.totalDebt), revolver: 0,
      equity: num(b.totalStockholdersEquity),
      totalAssets: num(b.totalAssets), totalLiabilities: num(b.totalLiabilities),
      check: num(b.totalAssets) - (num(b.totalLiabilities) + num(b.totalStockholdersEquity)
             + num(b.minorityInterest)),
      shares: num(i.weightedAverageShsOutDil),
      cashAndSTI: num(b.cashAndShortTermInvestments) || num(b.cashAndCashEquivalents),
    };
  });
}
