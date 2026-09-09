/* Blog: list mode, or a single post when ?post=<slug> is present. */

import { loadJSON, showError, fmtDate, el, base } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const SLUG = /^[\w-]+$/;   // path-traversal guard on the query param

async function renderList(host) {
  const posts = await loadJSON("posts/index.json");
  document.querySelector("h1").textContent = "Notes";
  document.querySelector(".sub").textContent =
    "Method notes and portfolio decisions. Nothing here is investment advice.";
  setAsOf(posts.length ? fmtDate(posts[0].date) : "—", "LATEST");

  const panel = el("div", { class: "panel" }, [
    el("div", { class: "panel-h" }, [el("h2", { text: `${posts.length} post${posts.length === 1 ? "" : "s"}` })]),
    el("div", { class: "panel-b flush" }, [
      el("div", { class: "tbl-wrap" }, [
        el("table", {}, [
          el("thead", {}, [el("tr", {}, [
            el("th", { text: "Date", scope: "col" }),
            el("th", { text: "Title", scope: "col" }),
            el("th", { text: "Summary", scope: "col" }),
          ])]),
          el("tbody", {}, posts.map((p) => el("tr", {}, [
            el("td", { class: "num", text: fmtDate(p.date) }),
            el("td", {}, [el("a", { href: `?post=${encodeURIComponent(p.slug)}`, text: p.title })]),
            el("td", { class: "note", text: p.summary || "" }),
          ]))),
        ]),
      ]),
    ]),
  ]);
  host.innerHTML = "";
  host.appendChild(panel);
}

async function renderPost(host, slug) {
  const res = await fetch(`${base()}posts/${slug}.md`);
  if (!res.ok) throw new Error(`posts/${slug}.md: HTTP ${res.status}`);
  const raw = await res.text();

  // Front matter: --- key: value --- then body
  let meta = {}, body = raw;
  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(raw);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = /^(\w+):\s*(.*)$/.exec(line.trim());
      if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    body = raw.slice(fm[0].length);
  }
  const title = meta.title || slug;
  document.title = `${title} — Quant Portfolio`;
  document.querySelector("h1").textContent = title;
  document.querySelector(".sub").textContent = meta.summary || "";
  if (meta.date) setAsOf(fmtDate(meta.date), "PUBLISHED");

  host.innerHTML = "";
  host.appendChild(el("p", {}, [el("a", { href: "blog.html", text: "← All notes" })]));
  host.appendChild(el("div", { class: "panel" }, [
    el("div", { class: "panel-b" }, [
      el("div", { class: "prose", html: DOMPurify.sanitize(marked.parse(body)) }),
    ]),
  ]));
}

(async function init() {
  renderShell();
  const host = document.getElementById("post");
  const slug = new URLSearchParams(location.search).get("post");
  try {
    if (slug && SLUG.test(slug)) {
      await new Promise((ok, no) => {
        let n = 2;
        const add = (src) => {
          const s = document.createElement("script");
          s.src = src; s.onload = () => --n || ok(); s.onerror = no;
          document.head.appendChild(s);
        };
        add("https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js");
        add("https://cdn.jsdelivr.net/npm/dompurify@3.1.5/dist/purify.min.js");
      });
      await renderPost(host, slug);
    } else {
      await renderList(host);
    }
  } catch (err) { showError(host, err); }
})();
