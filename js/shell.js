/* Shared application shell: nav, as-of control, theme toggle, command palette.
   Active state is derived from location.pathname and exposed as aria-current.
   Sections are the two books, the engine that runs the first of them, and the
   notes; a book section binds data-book on <html> so --book resolves. */

const SECTIONS = [
  { id: "home", label: "Overview", root: "index.html", nav: [] },
  { id: "events", label: "Current events", root: "events.html", nav: [
      ["Today", "events.html"],
      ["This week", "digest.html"],
    ] },
  // What is actually held, every account; the model's proposal lives under
  // Research (the owner's split, 2026-10-06).
  {
    id: "holdings", label: "My holdings", root: "usd/index.html",
    nav: [
      ["Overview", "usd/index.html", "USD book"],
      ["Analytics", "usd/analytics.html"],
      ["Activity", "usd/transactions.html"],
      ["Overview", "cad/index.html", "CAD book"],
      ["Analytics", "cad/analytics.html"],
      ["Activity", "cad/transactions.html"],
      ["Income account", "ibkr.html", "IBKR"],
    ],
  },
  {
    id: "research", label: "Research", root: "research/heldmodel.html",
    // Pages read as groups; the third element names the group a page starts.
    nav: [
      ["Held vs model", "research/heldmodel.html", "Model"],
      ["Model book", "research/index.html"],
      ["Target", "research/portfolio.html"],
      ["Rebalances", "research/holdings.html"],
      ["Optimizer", "research/mvo.html"],
      ["Regime", "research/regime.html"],
      ["Options", "research/options.html", "Options & vol"],
      ["Vol surface", "research/volsurface.html"],
      ["SPY vol", "research/voltrade.html"],
      ["Vol engine", "research/volengine.html"],
      ["Company models", "usd/model.html", "Companies"],
      ["Fundamentals", "usd/fundamentals.html"],
      ["Earnings calls", "research/transcripts.html"],
      ["Revisions", "research/revisions.html", "Ideas"],
      ["Demand tree", "research/demand.html"],
      ["Power", "research/power.html"],
      ["Renaissance 13F", "research/rentech.html"],
      ["Stat arb", "research/statarb.html"],
      ["Swing setups", "research/swing.html"],
      ["Small caps", "research/smallcap.html"],
    ],
  },
  {
    id: "venture", label: "Venture", root: "venture/index.html", book: "venture",
    nav: [],
  },
  // Three top-level items that answer one question, "how does it work",
  // read as one section with a second row (2026-10 review: 11 sections).
  {
    id: "how", label: "How it works", root: "methodology.html",
    nav: [
      ["Methodology", "methodology.html"],
      ["Mathematics", "mathematics.html"],
      ["Notes", "blog.html"],
    ],
  },
];

const DIRS = new Set(["usd", "cad", "research", "venture"]);

/* Pages live at two depths; window.ASSET_BASE ("" or "../") is already the
   convention for data paths, so links reuse it rather than hard-coding "../". */
const base = () => window.ASSET_BASE || "";
const href = (p) => base() + p;

function currentPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  const file = parts[parts.length - 1] || "index.html";
  const dir = parts[parts.length - 2];
  return DIRS.has(dir) ? `${dir}/${file}` : (DIRS.has(file) ? `${file}/index.html` : file);
}

function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "text") n.textContent = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(kids)) if (c) n.appendChild(c);
  return n;
}

/* ---------- theme ---------- */

const THEME_KEY = "qp-theme";
const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
}

/* Light is the default ground; the OS preference is honoured until the
   viewer chooses explicitly, and the choice is remembered. */
function resolvedTheme() {
  return document.documentElement.getAttribute("data-theme") || (mq && mq.matches ? "dark" : "light");
}

function toggleTheme() {
  const next = resolvedTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  document.querySelector("#theme-btn").textContent = next === "dark" ? "◐" : "◑";
  // Canvas pixels don't follow CSS tokens — tell chart modules to restyle.
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: next } }));
}

/* Chart modules subscribe here instead of listening to matchMedia directly, so
   the manual toggle and the OS change take the same path. */
export function onThemeChange(fn) {
  window.addEventListener("themechange", fn);
}
if (mq) mq.addEventListener?.("change", () => {
  if (!document.documentElement.getAttribute("data-theme")) {
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: resolvedTheme() } }));
  }
});

/* ---------- command palette ---------- */

let paletteExtras = [];

/* Pages register their own jump targets (tickers, mostly) so `/` reaches more
   than the static nav. */
export function registerCommands(items) {
  paletteExtras = items || [];
}

function allCommands() {
  const nav = SECTIONS.flatMap((s) =>
    s.nav.length
      ? s.nav.map(([label, p]) => ({ key: `${s.label} · ${label}`, hint: "page", go: href(p) }))
      : [{ key: s.label, hint: "page", go: href(s.root) }]
  );
  return nav.concat(paletteExtras);
}

function openPalette() {
  if (document.querySelector(".cmdk-back")) return;
  const input = el("input", {
    type: "text", placeholder: "Jump to a page or ticker…",
    "aria-label": "Command palette", autocomplete: "off", spellcheck: "false",
  });
  const list = el("div", { class: "cmdk-list", role: "listbox" });
  const box = el("div", { class: "cmdk", role: "dialog", "aria-modal": "true",
                          "aria-label": "Command palette" }, [input, list]);
  const back = el("div", { class: "cmdk-back" }, [box]);
  let items = [], idx = 0;

  const paint = () => {
    const q = input.value.trim().toLowerCase();
    items = allCommands()
      .filter((c) => !q || c.key.toLowerCase().includes(q))
      .slice(0, 40);
    idx = 0;
    list.innerHTML = "";
    if (!items.length) {
      list.appendChild(el("div", { class: "cmdk-empty", text: "No matches." }));
      return;
    }
    items.forEach((c, i) => {
      const row = el("div", { class: "cmdk-item", role: "option",
                              "aria-selected": i === idx ? "true" : "false" }, [
        el("span", { class: "k", text: c.key }),
        el("span", { class: "d", text: c.hint || "" }),
      ]);
      row.addEventListener("mousedown", (e) => { e.preventDefault(); run(c); });
      list.appendChild(row);
    });
  };
  const mark = () => [...list.children].forEach((n, i) =>
    n.setAttribute("aria-selected", i === idx ? "true" : "false"));
  const run = (c) => { close(); if (c.go) location.href = c.go; else if (c.act) c.act(); };
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey, true); };

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); mark();
      list.children[idx]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); mark();
      list.children[idx]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[idx]) run(items[idx]); }
  }

  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  input.addEventListener("input", paint);
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(back);
  paint();
  input.focus();
}

/* ---------- render ---------- */

export function renderShell({ asOf = null, asOfLabel = "AS OF" } = {}) {
  const here = currentPath();
  const section =
    SECTIONS.find((s) => s.nav.some(([, p]) => p === here)) ||
    SECTIONS.find((s) => s.root === here) ||
    SECTIONS[0];
  // A section spanning both books takes its colour from the page's folder.
  const book = section.book || (here.startsWith("usd/") ? "usd" : here.startsWith("cad/") ? "cad" : null);
  if (book) document.documentElement.setAttribute("data-book", book);
  document.documentElement.setAttribute("data-section", section.id);

  const mark = el("span", { class: "brand-mark", "aria-hidden": "true" },
    [el("i"), el("i"), el("i"), el("i")]);
  const r1 = el("div", { class: "shell-r1" }, [
    el("a", { class: "brand", href: href("index.html") }, [mark, el("span", { class: "brand-word", text: "Two Books" })]),
    el("nav", { class: "shell-sections", "aria-label": "Sections" },
      SECTIONS.map((s) =>
        el("a", { href: href(s.root), "data-book": s.book || null,
                  "aria-current": s.id === section.id ? "page" : null },
           [s.book ? el("span", { class: "bk", "aria-hidden": "true" }) : null,
            el("span", { text: s.label })]))),
    el("div", { class: "shell-right" }, [
      el("span", { class: "asof", id: "asof" }),
      el("button", { class: "icon-btn", id: "cmdk-btn", type: "button",
                     "aria-label": "Open command palette (press /)", text: "⌘ /" }),
      el("button", { class: "icon-btn", id: "theme-btn", type: "button",
                     "aria-label": "Toggle colour theme",
                     text: resolvedTheme() === "dark" ? "◐" : "◑" }),
      storedKey()
        ? el("button", { class: "icon-btn", id: "lock-btn", type: "button", title: "Lock the site",
                         "aria-label": "Lock the site (asks for the passcode again)", text: "Lock" })
        : null,
    ]),
  ]);

  const kids = [r1];
  if (section.nav.length) {
    kids.push(el("nav", { class: "shell-r2", "aria-label": `${section.label} pages` },
      section.nav.flatMap(([label, p, group]) => [
        group ? el("span", { class: "r2-group", "aria-hidden": "true", text: group }) : null,
        el("a", { href: href(p), text: label,
                  "aria-current": p === here ? "page" : null })].filter(Boolean))));
  }

  const header = el("header", { class: "shell" }, [el("div", { class: "shell-in" }, kids)]);
  const mount = document.getElementById("shell");
  mount.replaceWith(header);

  document.getElementById("theme-btn").addEventListener("click", toggleTheme);
  document.getElementById("lock-btn")?.addEventListener("click", lockSite);
  document.getElementById("cmdk-btn").addEventListener("click", openPalette);
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === "/" && !typing && !document.querySelector(".cmdk-back")) {
      e.preventDefault(); openPalette();
    }
  });

  if (asOf) setAsOf(asOf, asOfLabel);
  return header;
}

/* Business days between an ISO date and today. */
function businessDaysSince(iso) {
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date(); now.setHours(12, 0, 0, 0);
  let n = 0;
  for (const t = new Date(d); t < now; t.setDate(t.getDate() + 1)) {
    const w = t.getDay();
    if (w !== 0 && w !== 6) n += 1;
  }
  return n;
}

/* The as-of chip, marked stale when the page's data is more than three
   business days old: a page whose source stopped updating should say so,
   not look current. */
/* `ages: false` for a date that is not a data refresh (a fiscal year, the last
   rebalance) or a page that is a dated research snapshot by design: the chip
   shows the date without turning amber. */
let LOCK_CHANNEL = null;
/* sessionStorage can be missing or blocked (private modes, the page checker). */
const storedKey = () => { try { return sessionStorage.getItem("site-key"); } catch { return null; } };
/* The lock (site_lock.py): an unlocked page lends its key to a tab opened
   from it, so a link opened in a new tab does not ask again; a click on a
   sealed document (PDF, note) opens it decrypted. Neither does anything on a
   local, unencrypted copy of the site. */
if (typeof BroadcastChannel !== "undefined") {
  try {
    const ch = new BroadcastChannel("site-key");
    ch.onmessage = (e) => {
      const k = storedKey();
      if (e.data && e.data.ask && k) ch.postMessage({ key: k });
      // Lock pressed in another tab: every tab locks.
      if (e.data && e.data.lock) { try { sessionStorage.removeItem("site-key"); } catch { /* none */ } location.reload(); }
    };
    LOCK_CHANNEL = ch;
  } catch { /* no channel: a new tab asks for the passcode */ }
}
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("click", (e) => {
    const a = e.target?.closest?.("a[href]");
    if (!a || !storedKey()) return;
    const href = a.getAttribute("href");
    if (/^(https?:|mailto:|#)/.test(href) || !/\.(pdf|md|csv|txt|xlsx)(\?|#|$)/i.test(href)) return;
    e.preventDefault();
    import("./common.js").then((m) => m.openSealed(href));
  });
}

function lockSite() {
  try { sessionStorage.removeItem("site-key"); } catch { /* none */ }
  try { LOCK_CHANNEL?.postMessage({ lock: true }); } catch { /* other tabs keep their key */ }
  location.reload();
}

/* Segmented toggles mark their state with .active; mirror it to aria-pressed
   for every .seg on every page, now and after each click. */
function syncPressed(root = document) {
  root.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.classList.contains("active"))));
}
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.(".seg")) setTimeout(() => syncPressed(), 0);
  });
  document.addEventListener("DOMContentLoaded", () => syncPressed());
  setTimeout(() => syncPressed(), 1500);
}

export function setAsOf(text, label = "AS OF", { ages = true, note = "" } = {}) {
  const n = document.getElementById("asof");
  if (!n) return;
  n.innerHTML = "";
  n.append(label + " ", el("b", { text }));
  if (!ages) {
    n.classList.remove("stale");
    if (note) n.setAttribute("title", note); else n.removeAttribute("title");
    return;
  }
  const age = /^\d{4}-\d{2}-\d{2}/.test(String(text)) ? businessDaysSince(text) : null;
  const stale = age != null && age > 3;
  n.classList.toggle("stale", stale);
  if (stale) {
    n.append(el("span", { class: "asof-age", text: ` · ${age} business days old` }));
    n.setAttribute("title", "This page's data has not been refreshed recently; its source runs less often than daily or has stopped.");
  } else {
    n.removeAttribute("title");
  }
}
