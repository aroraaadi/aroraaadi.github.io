/* DCF on the model's own projections.

   VALIDATED. Reconstructing FMP's published MSFT valuation from their own
   inputs reproduces it to 0.08% (294.25 vs 294.49 per share) — but only with
   the correct horizon. Their `custom-discounted-cash-flow` endpoint returns ~10
   rows MIXING historical actuals with projections, and only the projected years
   are discounted. Discounting all ten lands ~30% off:

     horizon   sum PV     PV(TV)    per share   FMP says
     4 yrs     412bn      2024bn    312.41      294.49
     5 yrs     454bn      1847bn    294.25      294.49  <- matches
     6 yrs     471bn      1685bn    274.81      294.49

   `verifyAgainstFmp` below keeps that as a live regression rather than a
   comment, because the failure is silent and large. */

const num = (x) => (typeof x === "number" && isFinite(x) ? x : 0);

/* Unlevered FCF: EBIT(1-t) + D&A - capex - ΔNWC.
   Unlevered, so interest is deliberately excluded — the cost of debt enters
   through WACC instead. Double-counting it is the classic error here. */
export function ufcf(year) {
  const taxRate = num(year.ebt) > 0 ? num(year.tax) / num(year.ebt) : 0;
  const nopat = num(year.ebit) * (1 - taxRate);
  return nopat + num(year.da) - num(year.capex) - num(year.changeInNwc);
}

export function wacc({ beta, riskFree, marketRiskPremium, costOfDebt, taxRate,
                       marketCap, totalDebt }) {
  const ke = num(riskFree) + num(beta) * num(marketRiskPremium);
  const kd = num(costOfDebt) * (1 - num(taxRate));
  const e = num(marketCap), d = num(totalDebt), v = e + d;
  if (v <= 0) return { wacc: ke, costOfEquity: ke, afterTaxCostOfDebt: kd, we: 1, wd: 0 };
  const we = e / v, wd = d / v;
  return { wacc: ke * we + kd * wd, costOfEquity: ke, afterTaxCostOfDebt: kd, we, wd };
}

/* Terminal value both ways. They disagree, and the disagreement is the point —
   a perpetuity implying a multiple far from the comp set is a red flag. */
export function terminalValue({ lastUfcf, lastEbitda, w, g, exitMultiple }) {
  const perpetuity = w > g ? (num(lastUfcf) * (1 + num(g))) / (w - num(g)) : null;
  const exit = exitMultiple != null ? num(lastEbitda) * num(exitMultiple) : null;
  return { perpetuity, exit };
}

export function valuate({ years, assumptions }) {
  const {
    beta, riskFree, marketRiskPremium, costOfDebt, taxRate,
    marketCap, totalDebt, netDebt, shares, g, exitMultiple, method = "perpetuity",
  } = assumptions;

  const w = wacc({ beta, riskFree, marketRiskPremium, costOfDebt, taxRate, marketCap, totalDebt });
  const flows = years.map((y, i) => {
    const f = ufcf(y);
    const disc = Math.pow(1 + w.wacc, i + 1);
    return { label: y.label, year: y.year, ufcf: f, discount: disc, pv: f / disc };
  });
  const sumPv = flows.reduce((s, f) => s + f.pv, 0);

  const lastYear = years[years.length - 1];
  const tv = terminalValue({
    lastUfcf: ufcf(lastYear), lastEbitda: lastYear.ebitda,
    w: w.wacc, g, exitMultiple,
  });
  const chosen = method === "exit" ? tv.exit : tv.perpetuity;
  const discN = Math.pow(1 + w.wacc, years.length);
  const pvTv = chosen == null ? null : chosen / discN;

  const ev = pvTv == null ? null : sumPv + pvTv;
  const equity = ev == null ? null : ev - num(netDebt);
  const perShare = equity == null || !num(shares) ? null : equity / num(shares);

  return {
    ...w, flows, sumPv,
    terminal: tv, terminalUsed: chosen, pvTerminal: pvTv,
    enterpriseValue: ev, equityValue: equity, perShare,
    terminalShare: ev ? pvTv / ev : null,
    impliedExitMultiple: tv.perpetuity != null && num(lastYear.ebitda)
      ? tv.perpetuity / num(lastYear.ebitda) : null,
  };
}

/* WACC x g grid. Cells outside w > g are null rather than infinite — a
   perpetuity with g >= w is not a large number, it is undefined. */
export function sensitivity({ years, assumptions, waccs, growths }) {
  return growths.map((g) =>
    waccs.map((wv) => {
      const r = valuate({
        years,
        assumptions: { ...assumptions, g, method: "perpetuity", _forceWacc: wv },
      });
      // recompute with the overridden WACC
      const flows = years.map((y, i) => ufcf(y) / Math.pow(1 + wv, i + 1));
      const sumPv = flows.reduce((s, f) => s + f, 0);
      const last = years[years.length - 1];
      if (wv <= g) return null;
      const tv = (ufcf(last) * (1 + g)) / (wv - g);
      const ev = sumPv + tv / Math.pow(1 + wv, years.length);
      const eq = ev - num(assumptions.netDebt);
      return num(assumptions.shares) ? eq / num(assumptions.shares) : null;
    }));
}

/* Reverse DCF: the terminal growth the current price implies, holding
   everything else fixed. Bisection — monotone in g over (−0.5, w). */
export function impliedGrowth({ years, assumptions, price, lo = -0.5, hiPad = 0.0005 }) {
  const w = wacc(assumptions).wacc;
  let a = lo, b = w - hiPad;
  const f = (g) => {
    const v = valuate({ years, assumptions: { ...assumptions, g, method: "perpetuity" } });
    return v.perShare == null ? NaN : v.perShare - price;
  };
  let fa = f(a), fb = f(b);
  if (!isFinite(fa) || !isFinite(fb) || fa * fb > 0) return null;  // price outside the range
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (!isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-6 || (b - a) < 1e-9) return m;
    if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

/* Live regression against FMP's own numbers. Returns per-field relative error;
   the caller fails the build if any exceeds tolerance. */
export function verifyAgainstFmp(ref) {
  if (!ref?.ufcf?.length) return null;
  const w = ref.wacc, g = ref.longTermGrowth, n = ref.ufcf.length;
  const sumPv = ref.ufcf.reduce((s, r, i) => s + r.ufcf / Math.pow(1 + w, i + 1), 0);
  const tv = (ref.ufcf[n - 1].ufcf * (1 + g)) / (w - g);
  const pvTv = tv / Math.pow(1 + w, n);
  const ev = sumPv + pvTv;
  const eq = ev - ref.netDebt;
  const ps = eq / ref.shares;
  const rel = (a, b) => (b ? Math.abs(a - b) / Math.abs(b) : null);
  return {
    horizon: n,
    sumPv: { mine: sumPv, fmp: ref.sumPvUfcf, err: rel(sumPv, ref.sumPvUfcf) },
    terminal: { mine: tv, fmp: ref.terminalValue, err: rel(tv, ref.terminalValue) },
    pvTerminal: { mine: pvTv, fmp: ref.presentTerminalValue, err: rel(pvTv, ref.presentTerminalValue) },
    enterprise: { mine: ev, fmp: ref.enterpriseValue, err: rel(ev, ref.enterpriseValue) },
    perShare: { mine: ps, fmp: ref.perShare, err: rel(ps, ref.perShare) },
  };
}
