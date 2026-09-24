/* Black-Scholes-Merton in the browser, matching options/pricing.py's
   conventions exactly: vega per ONE vol point, theta per CALENDAR day, rho
   per ONE percent of rate. Used by the pricer on the surface page. */

const SQRT2 = Math.SQRT2;

/* erf by Abramowitz & Stegun 7.1.26, |error| < 1.5e-7 — enough for a
   pricer whose inputs are quoted to four decimals. */
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const N = (x) => 0.5 * (1 + erf(x / SQRT2));
const n = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

export function bs(S, K, T, sigma, right, r = 0.0483, q = 0.0) {
  const nan = { price: NaN, delta: NaN, gamma: NaN, vega: NaN, theta: NaN, rho: NaN };
  if (!(S > 0 && K > 0 && T > 0 && sigma > 0)) return nan;
  const call = right === "C";
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / v, d2 = d1 - v;
  const eq = Math.exp(-q * T), er = Math.exp(-r * T), sq = Math.sqrt(T);
  const price = call ? S * eq * N(d1) - K * er * N(d2) : K * er * N(-d2) - S * eq * N(-d1);
  const delta = call ? eq * N(d1) : -eq * N(-d1);
  const gamma = eq * n(d1) / (S * sigma * sq);
  const vega = S * eq * n(d1) * sq / 100;
  const common = -(S * eq * n(d1) * sigma) / (2 * sq);
  const theta = (call ? common - r * K * er * N(d2) + q * S * eq * N(d1) : common + r * K * er * N(-d2) - q * S * eq * N(-d1)) / 365;
  const rho = (call ? K * T * er * N(d2) : -K * T * er * N(-d2)) / 100;
  return { price, delta, gamma, vega, theta, rho, d1, d2 };
}

/* Implied vol by bisection on price; NaN below intrinsic. */
export function impliedVol(price, S, K, T, right, r = 0.0483, q = 0.0) {
  if (!(price > 0 && S > 0 && K > 0 && T > 0)) return NaN;
  const intrinsic = right === "C" ? Math.max(S * Math.exp(-q * T) - K * Math.exp(-r * T), 0) : Math.max(K * Math.exp(-r * T) - S * Math.exp(-q * T), 0);
  if (price < intrinsic) return NaN;
  let lo = 1e-4, hi = 5;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (bs(S, K, T, mid, right, r, q).price > price) hi = mid; else lo = mid;
  }
  return 0.5 * (lo + hi);
}
