/* The arithmetic behind the swing page's price chart, free of the DOM so it can be tested under node. */

/** Exponential moving average of `values` (span n), seeded with the first value; one output per input. */
export function ema(values, n) {
  const k = 2 / (n + 1);
  const out = [];
  let prev = null;
  for (const v of values) {
    prev = prev == null ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** The horizontal lines for a setup row: [{ price, title, tone, dashed }], ordered by price, finite prices only. */
export function levelLines(row) {
  const lv = row.levels || {};
  const raw = [
    [row.signal_close, "signal close", "ink", false],
    [row.stop, "stop", "down", false],
    [row.target, "target", "up", false],
    [lv.vwap, "VWAP", "warn", true],
    [lv.fib_382, "Fib 38.2%", "muted", true],
    [lv.fib_618, "Fib 61.8%", "muted", true],
    [lv.swing_hi, "swing high", "muted", true],
    [lv.swing_lo, "swing low", "muted", true],
  ];
  return raw.filter(([p]) => Number.isFinite(p)).map(([price, title, tone, dashed]) => ({ price, title, tone, dashed }))
    .sort((a, b) => a.price - b.price);
}
