# Suggested features

Deliberately left out of the first version. Each entry notes what is already in place.

## 1. BOM alignment visualization
**What:** Side-by-side view of two BOMs (e.g. EBOM ↔ MBOM) with link lines between aligned occurrences; create/remove alignments; highlight unaligned occurrences.
**Why:** Shows whether every engineering occurrence is consumed in manufacturing, and where.
**In place:** `<alignments>` in the schema and `Alignment` in the model (round-tripped today); stable occurrence addresses (`BOM:R1/R5`) built only by `occurrencePath()`.

## 2. Product rule constraints and a solver
**What:** Rules such as "ENGINE=V8 requires MARKET=US"; check a configuration's validity, grey out option values that can no longer be selected, list all buildable variants.
**Why:** Today an invalid combination (e.g. V8 + EU) silently yields an incomplete BOM.
**Notes:** This is a SAT problem; a solver (possibly compiled to WASM, inlined as base64 to keep `file://` working) would sit behind the `parse/validate/evaluate` interface in `src/expr.ts`.

## 3. Revisions and revision rules
**What:** Item revisions, with a rule such as "latest released" or "as of date" selecting which revision each occurrence resolves to.

## 4. Undo / redo
**What:** Command stack around the model mutators in `src/model.ts`.
**Why:** Removing a relation is currently immediate and irreversible (until reopen).

## 6. Autosave to localStorage
**What:** Keep the working document across reloads; offer restore on start.

## 7. Large-BOM rendering
**What:** Virtualized rows (render only what is scrolled into view) once trees exceed ~5k visible rows; a full DOM table slows down beyond that.

## 7b. Graphical node-link view
**What:** Optional diagram view (the first version had one, replaced by the tree-table). Could return as a toggle for presentations.

## 8. Variant comparison
**What:** Diff the resolved structure of two configurations (added / removed / quantity-changed occurrences).

## 9. Command-line validator
**What:** Reuse `src/xml.ts` + `src/expr.ts` from Node to validate BOM XML in CI or PLM export pipelines. `DOMParser` would need a Node implementation (e.g. jsdom or `@xmldom/xmldom`).
