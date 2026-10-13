/* The owner's daily checklist: what to do each day, what runs by itself and whether it is, last night's red steps
   with their re-run command, alerts, the jobs done by hand, and the setup still open (src/ops/checklist.py). */
import { loadJSON, showError, fmtDate, el, renderStats, renderTable } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const $ = (id) => document.getElementById(id);
const TONE = { ok: "up", todo: "down", warn: "warn", info: "muted" };
const LABEL = { ok: "ok", todo: "to do", warn: "check", info: "n/a now" };
const pill = (s) => el("span", { class: `pill ${TONE[s] || "muted"}`, text: LABEL[s] || s });
const code = (t) => el("code", { text: t });
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "{}"); localStorage.setItem(k, JSON.stringify(v)); } catch { return {}; } };

function daily(C) {
  const key = `ops-ticks-${new Date().toLocaleDateString("en-CA")}`;       // the local day, not UTC's
  const ticks = store(key) || {};
  $("ops-daily").replaceChildren(...C.daily.map((d, i) => {
    const box = el("input", { type: "checkbox", "aria-label": `Done: ${d.task}` });
    box.checked = !!ticks[i];
    const li = el("li", { class: box.checked ? "done" : "" }, [box,
      el("div", {}, [el("strong", { text: d.task }), el("p", { text: `${d.when[0].toUpperCase()}${d.when.slice(1)}. ${d.why[0].toUpperCase()}${d.why.slice(1)}.` }),
                     el("p", {}, ["How: ", code(d.how)]), d.detail ? el("p", { class: "note", text: `Now: ${d.detail}` }) : null]),
      pill(d.status)]);
    box.addEventListener("change", () => { ticks[i] = box.checked; store(key, ticks); li.classList.toggle("done", box.checked); });
    return li;
  }));
  const todo = C.daily.filter((d) => d.status === "todo").length;
  $("ops-d-meta").textContent = todo ? `${todo} need you` : "nothing needs you";
}

function main_(C) {
  const n = C.last_night || {}, c = n.counts || {};
  const jobsDown = C.jobs.filter((j) => j.status === "todo").length;
  renderStats("ops-strip", [
    { label: "Needs you today", value: String(C.daily.filter((d) => d.status === "todo").length), tone: C.daily.some((d) => d.status === "todo") ? "down" : "up" },
    { label: "Last night", value: n.date ? `${c.ok || 0} ok` : "–", delta: n.date ? `${(c.failed || 0)} failed · ${(c.degraded || 0)} degraded` : "",
      deltaTone: (c.failed || c.degraded) ? "down" : "" },
    { label: "Jobs loaded", value: `${C.jobs.length - jobsDown} / ${C.jobs.length}`, tone: jobsDown ? "down" : "up" },
    { label: "Alerts, 36h", value: String((C.alerts || []).length), tone: (C.alerts || []).length ? "down" : "" },
    { label: "Setup open", value: String(C.setup.filter((s) => s.status === "todo").length) },
  ]);
  daily(C);
  $("ops-n-meta").textContent = n.date ? `run of ${fmtDate(n.date)}` : "";
  renderTable($("ops-night"), n.not_ok || [], [
    { key: "step", label: "Step" },
    { key: "status", label: "Result", fmt: (v) => el("span", { class: `pill ${v === "failed" ? "down" : "warn"}`, text: v }) },
    { key: "code", label: "Exit", cls: () => "note" },
    { key: "minutes", label: "Minutes", num: true },
    { key: "rerun", label: "Re-run it with", fmt: (v) => code(v) },
  ], { empty: "Every step finished green." });
  renderTable($("ops-alerts"), C.alerts || [], [
    { key: "at", label: "When", fmt: (v) => String(v).replace("T", " ").slice(0, 16) },
    { key: "source", label: "From" },
    { key: "title", label: "Alert" },
  ], { sortKey: "at", empty: "No alerts." });
  $("ops-weekly").textContent = `Weekly: ${C.weekly.when}: ${C.weekly.what}. Re-run a weekly step: ${C.weekly.rerun}.`;
  renderTable($("ops-jobs"), C.jobs, [
    { key: "label", label: "Job" }, { key: "when", label: "When" }, { key: "what", label: "What it does", cls: () => "note" },
    { key: "status", label: "Loaded", fmt: pill },
  ]);
  renderTable($("ops-hand"), C.by_hand, [
    { key: "task", label: "Task" }, { key: "when", label: "When", cls: () => "note" },
    { key: "how", label: "Command", fmt: (v) => code(v) }, { key: "why", label: "Why", cls: () => "note" },
  ]);
  renderTable($("ops-setup"), C.setup, [
    { key: "item", label: "File" }, { key: "enables", label: "Switches on", cls: () => "note" },
    { key: "how", label: "How", cls: () => "note" }, { key: "status", label: "State", fmt: (v) => el("span", { class: `pill ${v === "ok" ? "up" : "muted"}`, text: v === "ok" ? "set up" : "not set up" }) },
  ]);
}

async function main() {
  renderShell();
  let C;
  try { C = await loadJSON("data/checklist.json"); } catch { showError($("error"), new Error("The checklist has not been built yet.")); return; }
  setAsOf(C.built_ny.slice(0, 10), "BUILT", { maxAge: 2 });
  main_(C);
}

main();
