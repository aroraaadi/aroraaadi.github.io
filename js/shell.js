/* Shared application shell: nav, as-of control, theme toggle, command palette.
   Replaces the topbar that was copy-pasted into 9 pages with hand-authored
   class="active" (which silently went wrong whenever it was forgotten).
   Active state is derived from location.pathname and exposed as aria-current. */

const SECTIONS = [
  {
    id: "my", label: "Portfolio", root: "my/index.html",
    nav: [
      ["Dashboard", "my/index.html"],
      ["Positions", "my/portfolio.html"],
      ["Holdings", "my/holdings.html"],
      ["Fundamentals", "my/fundamentals.html"],
      ["Model", "my/model.html"],
      ["Transactions", "my/transactions.html"],
      ["Analytics", "my/analytics.html"],
    ],
  },
  {
    id: "research", label: "Research", root: "research/index.html",
    nav: [
      ["Dashboard", "research/index.html"],
      ["Model", "research/portfolio.html"],
      ["Rebalances", "research/holdings.html"],
      ["Optimizer", "research/mvo.html"],
    ],
  },
  { id: "blog", label: "Blog", root: "blog.html", nav: [] },
];

/* Pages live at two depths; window.ASSET_BASE ("" or "../") is already the
   convention for data paths, so links reuse it rather than hard-coding "../". */
const base = () => window.ASSET_BASE || "";
const href = (p) => base() + p;

function currentPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  const file = parts[parts.length - 1] || "index.html";
  const dir = parts[parts.length - 2];
  return dir === "my" || dir === "research" ? `${dir}/${file}` : file;
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

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
}

/* Dark is the default ground (see tokens.css) — the OS preference is not
   consulted, only an explicit stored choice. */
function resolvedTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
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

  const r1 = el("div", { class: "shell-r1" }, [
    el("span", { class: "brand", text: "Quant Portfolio" }),
    el("nav", { class: "shell-sections", "aria-label": "Sections" },
      SECTIONS.map((s) =>
        el("a", { href: href(s.root), text: s.label,
                  "aria-current": s.id === section.id ? "page" : null }))),
    el("div", { class: "shell-right" }, [
      el("span", { class: "asof", id: "asof" }),
      el("button", { class: "icon-btn", id: "cmdk-btn", type: "button",
                     "aria-label": "Open command palette (press /)", text: "⌘ /" }),
      el("button", { class: "icon-btn", id: "theme-btn", type: "button",
                     "aria-label": "Toggle colour theme",
                     text: resolvedTheme() === "dark" ? "◐" : "◑" }),
    ]),
  ]);

  const kids = [r1];
  if (section.nav.length) {
    kids.push(el("nav", { class: "shell-r2", "aria-label": `${section.label} pages` },
      section.nav.map(([label, p]) =>
        el("a", { href: href(p), text: label,
                  "aria-current": p === here ? "page" : null }))));
  }

  const header = el("header", { class: "shell" }, [el("div", { class: "shell-in" }, kids)]);
  const mount = document.getElementById("shell");
  mount.replaceWith(header);

  document.getElementById("theme-btn").addEventListener("click", toggleTheme);
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

export function setAsOf(text, label = "AS OF") {
  const n = document.getElementById("asof");
  if (!n) return;
  n.innerHTML = "";
  n.append(label + " ", el("b", { text }));
}
