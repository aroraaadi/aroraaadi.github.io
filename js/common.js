/* Shared helpers. ES module — no bundler, same-origin, modern browsers only.
   Consolidates what was previously duplicated across page modules:
   SLOT_VARS (3 local copies), fmtPct re-implemented as pct (2), the date-tick
   callback (4), and the tile builder (4 signatures). */

export const base = () => window.ASSET_BASE || "";

export async function loadJSON(path) {
  const full = base() + path;
  const res = await fetch(full);
  if (!res.ok) throw new Error(`${full}: HTTP ${res.status}`);
  return res.json();
}

export function showError(el, err) {
  el.innerHTML = "";
  const box = document.createElement("div");
  box.className = "error-box";
  box.textContent = `Failed to load data — ${err.message}`;
  el.appendChild(box);
}

/* ---------- formatting ---------- */

export const fmtPct = (x, dp = 1) => (x == null ? "–" : (x * 100).toFixed(dp) + "%");
export const fmtNum = (x, dp = 2) => (x == null ? "–" : Number(x).toFixed(dp));
export const fmtSigned = (x, dp = 1) =>
  x == null ? "–" : (x >= 0 ? "+" : "") + (x * 100).toFixed(dp) + "%";

export function fmtMoney(x) {
  if (x == null) return "–";
  const a = Math.abs(x), s = x < 0 ? "−" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(2)}`;
}

/* The T00:00:00 suffix forces local-midnight parsing and avoids the UTC
   off-by-one that makes dates render a day early in western timezones. */
export const parseDate = (iso) => new Date(iso + "T00:00:00");

export const fmtDate = (iso) =>
  parseDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const fmtMonth = (iso) =>
  parseDate(iso).toLocaleDateString(undefined, { month: "short", year: "2-digit" });

export const signClass = (x) => (x == null ? "" : x > 0 ? "up" : x < 0 ? "down" : "");

/* ---------- tokens ---------- */

/* tok() forces a style recalculation on every call and was invoked ~150 times
   per render. Cache per paint; bust on theme change. */
let tokCache = new Map();
export function tok(name) {
  if (tokCache.has(name)) return tokCache.get(name);
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  tokCache.set(name, v);
  return v;
}
export const clearTokCache = () => tokCache.clear();

/* Hex-alpha was previously built by string concatenation (tok("--down")+"22")
   and mvo.js sliced #rrggbb by index — both break silently the moment a token
   becomes rgb()/oklch(). Route every translucent colour through here. */
export function alpha(nameOrHex, a) {
  const v = nameOrHex.startsWith("--") ? tok(nameOrHex) : nameOrHex;
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  if (v.startsWith("rgb")) return v.replace(/^rgba?\(([^)]+)\)$/, (_, inner) => {
    const p = inner.split(/[,\s/]+/).filter(Boolean).slice(0, 3);
    return `rgba(${p.join(", ")}, ${a})`;
  });
  return v; // unknown format — return opaque rather than emit something invalid
}

/* Categorical slot for an entity: fixed by order of first appearance. */
export const SLOT_VARS = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"];
export const slotColor = (i) => (i < SLOT_VARS.length ? tok(SLOT_VARS[i]) : tok("--muted"));
export const slotColors = (n) => Array.from({ length: n }, (_, i) => slotColor(i));

/* Lighten (t > 0) or darken (t < 0) a hex colour toward white/black. */
function shade(hex, t) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t)));
  return "#" + ch.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");
}

/* Colours for a complete breakdown with MORE entities than palette slots.

   The eight hues are validated to be mutually distinguishable, but a 17-slice
   allocation needs 17 colours. Rather than invent new hues — which would break
   the CVD guarantee — this reuses the validated hues across lightness tiers:
   tier 0 is the base hue, tier 1 lightened, tier 2 darkened. That is the
   "composite encoding" escape hatch: hue alone no longer identifies a slice, so
   any chart using this MUST also carry direct labels or a full legend. Every
   caller here does. Slices are sorted by weight, so same-hue pairs are far
   apart in the ordering and rarely adjacent. */
export function breakdownColors(n) {
  const tiers = [0, 0.34, -0.3];
  return Array.from({ length: n }, (_, i) => {
    const hue = tok(SLOT_VARS[i % SLOT_VARS.length]);
    const tier = tiers[Math.floor(i / SLOT_VARS.length) % tiers.length];
    return tier === 0 ? hue : shade(hue, tier);
  });
}

/* ---------- DOM ---------- */

export function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(kids)) if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

/* One stat-strip renderer replaces the four divergent tile builders.
   defs: [{label, value, delta, tone, deltaTone}] */
export function renderStats(target, defs) {
  const host = typeof target === "string" ? document.getElementById(target) : target;
  host.innerHTML = "";
  host.className = "strip";
  for (const d of defs) {
    if (!d) continue;
    host.appendChild(el("div", { class: "stat" }, [
      el("div", { class: "stat-l", text: d.label }),
      el("div", { class: `stat-v ${d.tone || ""}`.trim(), text: d.value }),
      d.delta ? el("div", { class: `stat-d ${d.deltaTone || ""}`.trim(), text: d.delta }) : null,
    ]));
  }
}

export function buildLegend(target, items) {
  const host = typeof target === "string" ? document.getElementById(target) : target;
  if (!host) return;
  host.innerHTML = "";
  for (const it of items) {
    const mark = it.shape === "line"
      ? el("span", { class: "swatch-line", style: `border-top-color:${it.color}` })
      : el("span", { class: "swatch-rect", style: `background:${it.color}` });
    host.appendChild(el("span", { class: "key" }, [mark, el("span", { text: it.label })]));
  }
}

/* Sortable table headers — the site previously had no column sorting anywhere.
   rows: array of objects; cols: [{key, label, num, fmt, cls}] */
export function renderTable(tbodyOrTable, rows, cols, { sortKey = null, dir = -1 } = {}) {
  const table = tbodyOrTable.tagName === "TABLE" ? tbodyOrTable : tbodyOrTable.closest("table");
  const tbody = table.querySelector("tbody");
  let key = sortKey, d = dir;

  const paint = () => {
    const data = key
      ? [...rows].sort((a, b) => {
          const x = a[key], y = b[key];
          if (x == null) return 1;
          if (y == null) return -1;
          return (typeof x === "string" ? x.localeCompare(y) : x - y) * d;
        })
      : rows;
    tbody.innerHTML = "";
    for (const r of data) {
      tbody.appendChild(el("tr", {}, cols.map((c) => {
        const raw = r[c.key];
        const td = el("td", { class: [c.num ? "num" : "", c.cls ? c.cls(r) : ""].filter(Boolean).join(" ") });
        const content = c.fmt ? c.fmt(raw, r) : raw ?? "–";
        if (content instanceof Node) td.appendChild(content); else td.textContent = content;
        return td;
      })));
    }
    table.querySelectorAll("th[data-key]").forEach((th) => {
      if (th.dataset.key === key) th.setAttribute("aria-sort", d === 1 ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
  };

  const thead = table.querySelector("thead tr");
  thead.innerHTML = "";
  for (const c of cols) {
    const th = el("th", { class: [c.num ? "num" : "", "sortable"].join(" "),
                          "data-key": c.key, text: c.label, scope: "col", tabindex: "0" });
    const act = () => { if (key === c.key) d = -d; else { key = c.key; d = c.num ? -1 : 1; } paint(); };
    th.addEventListener("click", act);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
    thead.appendChild(th);
  }
  paint();
  return { repaint: paint };
}
