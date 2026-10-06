/* Editable statement grid.

   Cell states are visually distinct because they mean different things:
     reported  — locked, from the filing
     street    — consensus, editable
     seeded    — model-derived default, editable
     override  — you changed it; the badge is how you find your own edits later

   Keyboard: arrows move, Enter commits and moves down, Tab moves right, Esc
   reverts, Delete clears an override back to its seeded value. */

import { el } from "../common.js";

const fmtB = (v) => {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e12) return `${s}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(0)}M`;
  return `${s}${a.toFixed(0)}`;
};
const fmtPct = (v) => (v == null || !isFinite(v) ? "—" : (v * 100).toFixed(1) + "%");
const fmtDays = (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(0));

export const FORMATS = { money: fmtB, pct: fmtPct, days: fmtDays, x: (v) => (v == null ? "—" : v.toFixed(2) + "x") };

/* rows: [{key, label, fmt, indent, bold, rule, calc:(year)=>value}]
   cols: [{label, actual}]  */
export function renderGrid(host, { rows, cols, values, editable, onEdit, overrides = {},
                                   overrideOffset = 0 }) {
  host.innerHTML = "";
  const table = el("table", { class: "grid" });
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", { text: "", scope: "col", class: "grid-label" }),
      ...cols.map((c) =>
        el("th", { class: `num${c.actual ? " actual" : ""}`, scope: "col", text: c.label })),
    ]),
  ]);
  const tbody = el("tbody");

  rows.forEach((r) => {
    const tr = el("tr", { class: [r.rule ? "rule" : "", r.bold ? "bold" : ""].filter(Boolean).join(" ") });
    tr.appendChild(el("td", {
      class: `grid-label${r.indent ? " indent" : ""}`, text: r.label,
      title: r.hint || "",
    }));

    cols.forEach((c, ci) => {
      const v = values[ci]?.[r.key];
      const isEditable = editable && !c.actual && r.editable;
      // Overrides are keyed by PROJECTED index; ci counts history columns too.
      const ov = overrides[`${r.key}:${ci - overrideOffset}`];
      const state = c.actual ? "reported"
        : ov != null ? "override"
        : r.source === "street" ? "street" : "seeded";

      const td = el("td", {
        class: `num cell ${state}${isEditable ? " editable" : ""}`,
        tabindex: isEditable ? "0" : null,
        "data-row": r.key, "data-col": String(ci),
        title: state === "override" ? "your override — Delete to reset"
             : state === "street" ? "street consensus"
             : state === "seeded" ? "model-derived default" : "as reported",
      });
      td.textContent = (r.fmt || fmtB)(v);
      if (isEditable) wireCell(td, { row: r, colIndex: ci, raw: v, onEdit });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  host.appendChild(table);
  return table;
}

function wireCell(td, { row, colIndex, raw, onEdit }) {
  const begin = () => {
    if (td.querySelector("input")) return;
    const kind = row.kind || "money";
    const start = raw == null ? "" :
      kind === "pct" ? (raw * 100).toFixed(2) :
      kind === "days" ? raw.toFixed(1) :
      String(Math.round(raw));
    const input = el("input", { class: "cell-input", value: start, type: "text",
                                "aria-label": `${row.label}, column ${colIndex + 1}` });
    td.textContent = "";
    td.appendChild(input);
    input.focus();
    input.select();

    const commit = (move) => {
      const txt = input.value.trim();
      let val = null;
      if (txt !== "") {
        const n = parseFloat(txt.replace(/[, %]/g, ""));
        if (isFinite(n)) val = kind === "pct" ? n / 100 : n;
      }
      cleanup();
      onEdit(row.key, colIndex, val);
      if (move) focusRel(td, move);
    };
    const cancel = () => { cleanup(); td.textContent = (row.fmt || fmtB)(raw); };
    let done = false;
    const cleanup = () => {
      if (done) return;            // blur can fire after Enter already committed
      done = true;
      if (input.isConnected) input.remove();
      td.focus();
    };

    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commit([1, 0]); }
      else if (e.key === "Tab") { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", () => { if (!done) commit(null); });
  };

  td.addEventListener("dblclick", begin);
  td.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); begin(); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault(); onEdit(row.key, colIndex, null);
    } else if (e.key.length === 1 && /[-\d.]/.test(e.key)) {
      begin();
      const inp = td.querySelector("input");
      if (inp) inp.value = e.key;
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      focusRel(td, { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]);
    }
  });
}

function focusRel(td, [dr, dc]) {
  const tr = td.parentElement, tbody = tr.parentElement;
  const rowIdx = [...tbody.children].indexOf(tr);
  const colIdx = [...tr.children].indexOf(td);
  // Skip rows that have no editable cell in this column rather than dead-ending.
  for (let step = 1; step < 60; step++) {
    const r = tbody.children[rowIdx + dr * step];
    const target = dr ? r?.children[colIdx] : tr.children[colIdx + dc * step];
    if (!target) return;
    if (target.classList?.contains("editable")) { target.focus(); return; }
    if (!dr) return;
  }
}
