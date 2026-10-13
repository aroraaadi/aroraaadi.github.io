/* The squarified treemap the holdings maps use (home page, macro desk). */

export function squarify(items, x, y, w, h, out) {
  if (!items.length) return;
  if (items.length === 1) { out.push({ ...items[0], x, y, w, h }); return; }
  const total = items.reduce((s, i) => s + i.area, 0);
  const side = Math.min(w, h);
  let row = [], best = Infinity, i = 0;
  const worst = (r) => {
    const s = r.reduce((a, b) => a + b.area, 0), mx = Math.max(...r.map((q) => q.area)), mn = Math.min(...r.map((q) => q.area));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  for (; i < items.length; i++) {
    const next = worst(row.concat(items[i]));
    if (row.length && next > best) break;
    row.push(items[i]); best = next;
  }
  const rs = row.reduce((a, b) => a + b.area, 0);
  if (w >= h) {
    const rw = rs / h; let yy = y;
    row.forEach((r) => { const rh = r.area / rw; out.push({ ...r, x, y: yy, w: rw, h: rh }); yy += rh; });
    squarify(items.slice(i), x + rw, y, w - rw, h, out);
  } else {
    const rh = rs / w; let xx = x;
    row.forEach((r) => { const cw = r.area / rh; out.push({ ...r, x: xx, y, w: cw, h: rh }); xx += cw; });
    squarify(items.slice(i), x, y + rh, w, h - rh, out);
  }
  void total;
}

/* Solid fills, the way a holdings map reads at a glance: green for a gain
   (on the day, or on average cost), red for a loss, deeper the larger it is. The colours are the
   same in both themes — the map carries its own ground, like a chart does —
   and the text is white on every box. */
export function boxColor(g, full = 0.3) {
  const k = Math.min(1, Math.abs(g) / full);           // full strength at ±30% on cost, ±3% on the day
  // A flat move is grey, so a −0.02% day does not read like a −2% one.
  return g >= 0
    ? `hsl(110, ${6 + 36 * k}%, ${30 + 15 * k}%)`
    : `hsl(5, ${6 + 52 * k}%, ${30 + 14 * k}%)`;
}

