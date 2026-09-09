# Forward-Looking Construction Addendum — implementation status

Tracks the "Forward-Looking Portfolio Construction" spec addendum against what
is actually running. Updated 2026-09-09.

| § | Item | Status |
|---|---|---|
| 7.0 | EWMA / GARCH(1,1) vol forecast | **shipped** — `quant/vol_forecast.py` |
| 7.0 | Implied-vol blend, VRP haircut | **seam only** — no option feed; see below |
| 7.1.1 | Equilibrium prior (reverse optimization) | **shipped** — `expected_returns.equilibrium_prior` |
| 7.1.2 | Black-Litterman | **shipped, production default** (`EXPECTED_RETURN_MODEL="bl"`) |
| 7.1.3 | Grinold-Kroner / Damodaran implied ERP | **not built** — `ERP_FORWARD` is a config constant |
| 7.1.4 | Grinold alpha scaling `IC x sigma x z` | **shipped** — but IC is assumed, not measured |
| 7.1.5 | Option-surface conditioning | not built (same blocker as 7.0 blend) |
| 7.2.1 | Ledoit-Wolf shrinkage | already existed; intensity now published |
| 7.2.2 | Factor covariance `BFB' + D` | partial — PCA exists, `F` is sample, not forecast |
| 7.2.3 | Conditional vol on the diagonal | **shipped** — `vol_forecast.rescale_cov` |
| 7.2.4 | Regime-switching overlay | not built (research track) |
| 7.2.5 | Copulas for tail dependence | not built (belongs to 7.4) |
| 7.3 | Robustness layer | **not built** — see "biggest remaining gap" |
| 7.4 | Scenario / CVaR path | **not built** |
| 7.5 | Gârleanu-Pedersen multi-period | not built (gated on a cost model, correctly) |
| 7.6 | Decision-focused learning | research track, untouched |
| 7.7 | Risk parity / HRP no-view baseline | **not built** |
| 7.8 | Complexity diagnostics | **shipped** — `risk.complexity_diagnostics` |

## What changed in the numbers

Same universe, same date, only the (mu, Sigma) stack differs:

| | before | after |
|---|---|---|
| one-way turnover | 53.5% | **10.4%** |
| positions | 11 | 12 |
| model vol | 12.0% | 13.4% |
| largest weight | COST 20.6% | VLO 16.8% |

The turnover collapse is the headline and it is the expected result, not a
surprise: point-estimate MVO on raw signal scores is Michaud's error maximizer,
so its weights move whenever the ranking moves. Anchoring to an equilibrium
prior means a weight only moves when the *view* moves, and views are small
relative to the prior by construction.

## Two corrections made while building this

**1. Risk aversion must not come from a realized mean.** The textbook estimator
`lambda = (mean(r_mkt) - rf) / var(r_mkt)` is itself the backward-looking input
the addendum exists to remove. On this 3-year window it implied `lambda > 6` and
produced equilibrium returns of **55-69% a year** for high-beta names and
**negative** ones for low-beta names — priors that do not merely mis-scale the
cross-section, they invert it. Replaced with

    lambda = beta_universe * ERP_forward / var(universe)

which makes `w_cap' pi = beta x ERP` hold as an identity (verified to 1.4e-17)
and removes realized means from the prior entirely. `ERP_FORWARD` is now the
single asserted return expectation in the system, which is the right number of
places for one to live. 7.1.3 replaces it with an implied ERP.

**2. The risk-aversion clamp then had to be widened.** `(1.0, 6.0)` was sized
for the old noisy estimator and immediately bound at the floor under the new
definition (`lambda = 0.81`), silently breaking the identity it was supposed to
protect. Now `(0.3, 10.0)` — a sanity rail, not an active constraint. A clamp
calibrated for one estimator is a bug when the estimator changes.

## On 7.8 and the MIN_POSITIONS=8 floor

`MIN_POSITIONS = 8` is in the optimizer, and 7.8 warns against exactly this kind
of hardcoded count. The distinction 7.8 draws is the one that applies: it is an
**operational** constraint requested directly by the portfolio owner, not an
inference from the estimation-risk literature, and it is a *floor* (more names)
rather than the *cap* the paper's argument would imply. The estimation-risk
question is answered separately by the diagnostics, which currently say the
concern is not active here:

    Ledoit-Wolf shrinkage intensity   0.090   (warn at 0.60)
    N / T                             0.095
    distinct covariance terms         276

At 24 names and 252 observations the sample covariance is well supported and
shrinkage is barely engaging. Nothing in the current book is near the regime the
paper describes — and the diagnostic, not a name count, is what will say so if
that changes.

## The blend is a seam, not a feature

`vol_forecast.implied_vol()` returns `{}` for every name because no option-chain
feed is wired in. Consequences, stated plainly:

* `VOL_FORECAST_METHOD = "blend"` currently produces exactly the EWMA/GARCH
  result and logs that it did.
* There is deliberately **no** `"trailing"` option in `VOL_FORECAST_METHOD`. The
  addendum's specific warning is against a silent fallback to trailing-252, so
  that path is not reachable by configuration. `trailing_252` is published
  beside the forecast for audit only.
* Wiring a chain source means implementing `implied_vol()` alone.

## Estimator noise, measured

EWMA at `lambda = 0.94` has an effective sample of ~32 observations, so its
per-name standard error is ~12.4% of the level. Over 400 simulated paths of a
known-vol process the estimator came back **unbiased** (-0.5%) with dispersion
**12.6%** against the 12.4% theoretical value. That responsiveness is bought
with variance, and it is the reason GARCH(1,1) is available as a config switch:
it adds mean reversion in variance, which EWMA structurally cannot represent
(EWMA is the `alpha + beta = 1` boundary case — a random walk in variance).

## Biggest remaining gap

**7.3 (robustness) and 7.4 (scenario/CVaR).** Black-Litterman fixes the
*location* of mu but the optimizer still treats the posterior as certain. 7.3 is
the layer that stops that, and 7.4 shares its scenario generator with the
ruin-probability module that already exists — building either one twice is the
failure mode the addendum explicitly calls out. 7.7 (HRP) is also worth having
sooner than its priority suggests: seven of the current names have no
fundamentals history in the July snapshot, and a per-sleeve no-view baseline is
a more honest answer for those than a fabricated view.
