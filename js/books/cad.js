/* The CAD book, as the site sees it.

   The mirror of books/cad.py. Everything here follows from "this book is run
   by hand": it is measured against equal weight rather than an optimizer
   target, it has no model column because no model has a view on these names,
   and it gets no factor panel because the PCA risk model is fitted on the USD
   trading universe and would be reporting someone else's loadings. */

export const SPEC = {
  key: "cad",
  runBy: "run by hand",

  driftTitle: "Drift from equal weight",
  driftLabel: "Drift vs equal weight",
  targetLabel: "Equal weight",
  driftMeta: (b) => {
    const n = Object.keys(b.target || {}).length;
    return n ? `${n} names · ${(100 / n).toFixed(1)}% each` : "no target";
  },
  // The owner's band (books/cad.py BAND_TOTAL): past 12% one-way a top-up is due.
  driftTone: (gap) => (gap > 0.12 ? "down" : "up"),
  gapAlert: 0.05,          // books/cad.py BAND_ABSOLUTE

  showModelColumn: false,
  modelToggle: false,
  factorPanel: false,
  legacyLedger: false,

  symbolLink: () => `${window.ASSET_BASE || ""}cad/index.html`,
};
