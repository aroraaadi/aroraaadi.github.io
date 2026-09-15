# Detecting a regime shift: what to read, and what it supports

Reference for `valuation/regime_detect.py` and `quant/rebalance.py`. Grouped by
what each paper actually licenses you to do, because the evidence is much
stronger for some of these moves than others — and the gap between "regimes
exist" and "you can trade them" is where most of the money is lost.

## Detecting the state

- **Hamilton (1989)**, *A New Approach to the Economic Analysis of Nonstationary
  Time Series and the Business Cycle*, Econometrica. The origin of Markov
  regime switching. This is what `stress_state()` fits, via
  `statsmodels.tsa.regime_switching`.
- **Kritzman, Page & Turkington (2012)**, *Regime Shifts: Implications for
  Dynamic Strategies*, FAJ. A two-state hidden Markov model on turbulence,
  inflation and growth. The closest thing to a blueprint for this repo's
  Layer A, and the source of the two-state choice.
- **Kritzman & Li (2010)**, *Skulls, Financial Turbulence, and Risk Management*,
  FAJ. The Mahalanobis turbulence index — `regime_detect.turbulence()`.
- **Kritzman, Li, Page & Rigobon (2011)**, *Principal Components as a Measure of
  Systemic Risk*, JPM. The absorption ratio: when few factors explain most
  variance, diversification is doing less than the weights suggest, and spikes
  tend to precede drawdowns. `regime_detect.absorption()`.
- **Pagan & Sossounov (2003)** and **Bry & Boschan (1971)**. Algorithmic
  bull/bear dating, if you ever want discrete turning points rather than
  probabilities. Not used here — probabilities blend, dates switch.

## What regimes do to a portfolio

- **Ang & Bekaert (2002)**, *International Asset Allocation with Regime Shifts*,
  RFS. Correlations rise exactly when diversification is needed. This is the
  argument for regime-conditional covariance, which `regimes.covariance()`
  already does.
- **Chow, Jacquier, Kritzman & Lowry (1999)**, *Optimal Portfolios in Good Times
  and Bad*, FAJ. Blending quiet and turbulent covariance estimates — the 60/40
  blend in `regimes.covariance()` is a crude version of this.
- **Guidolin & Timmermann (2007)**, *Asset allocation under multivariate regime
  switching*, JEDC.

## Acting on it — and how much the evidence actually supports

Read this section in order. The strength of the evidence falls sharply from top
to bottom, and the design here follows that ordering: the nowcast drives risk
first and returns only weakly.

- **Moreira & Muir (2017)**, *Volatility-Managed Portfolios*, JF. The strongest
  result in the group: scaling exposure inversely with recent realised
  volatility improves Sharpe across many factors. Volatility is persistent in a
  way expected returns are not.
- **Barroso & Santa-Clara (2015)**, risk-managed momentum. Same mechanism,
  applied to the factor most in need of it.
- **Daniel & Moskowitz (2016)**, *Momentum Crashes*, JFE, and **Cooper,
  Gutierrez & Hameed (2004)**, *Market States and Momentum*, JF. Momentum's
  crashes are concentrated in stressed states following market declines — a
  reason to condition position sizing on the stress probability specifically.
- **Haddad, Kozak & Santosh (2020)** on factor timing, read **alongside Asness's
  scepticism** rather than instead of it. Factor timing is far weaker than
  volatility timing. This pair is the reason `regime_detect.py` separates an
  estimated stress state from an unfitted narrative score sheet, and caps every
  regime-driven action at low confidence until archived nowcasts have been
  scored against a uniform baseline.

## Macro state

- **Estrella & Mishkin (1998)**, the yield curve as a recession predictor.
  `curve` in the feature set (FMP `treasury-rates`, stored daily to 2006).
- **Gilchrist & Zakrajšek (2012)**, *Credit Spreads and Business Cycle
  Fluctuations*, AER. The excess bond premium. The `credit` feature is a cruder
  Baa-minus-10y spread, chosen because FRED serves only a rolling three years of
  the licensed ICE OAS series — see `valuation/macro.credit_spread`.
- **Sahm (2019)**, the real-time unemployment recession rule. FRED
  `SAHMREALTIME`, in the feature set.

## Trading and rebalancing

- **Gârleanu & Pedersen (2013)**, *Dynamic Trading with Predictable Returns and
  Transaction Costs*, JF. Trade partway toward an "aim" portfolio rather than to
  the point solution; slower-decaying signals deserve more weight.
  `policy.ADJUST_FRACTION = 0.30`.
- **Michaud (1989)**, *The Markowitz Optimization Enigma: Is Optimized
  Optimal?*, FAJ. Error maximisation. Directly explains the 20.5% turnover
  measured on this book when the same views are redrawn within half their own
  stated uncertainty — the measurement that sets the bands.
- **Jaconetti, Kinniry & Zilbering (2010)**, Vanguard. Rebalancing frequency
  versus tolerance bands; thresholds beat calendars.
- **Masters (2003)** and **Donohue & Yip (2003)** on optimal no-trade bands: the
  band should widen with a name's contribution to tracking error and with cost.

## Two cautions specific to this repo

`qplatform/STATUS.md` records that bands must be calibrated against the
**rebalancing premium** (measured here at 0.20%/yr) and **not** the
diversification return (1.59%/yr). Confusing them overstates the benefit about
eightfold and sets the bands far too tight.

And the standing limitation, stated in `regime_detect.py` itself: the stress
model's parameters are fitted on the full sample. That is defensible for a live
reading and wrong for a backtest. Any test of this signal must refit on an
expanding window, and the narrative layer has no track record at all yet.
