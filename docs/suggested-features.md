# Suggested features

Deliberately left out of the first version. Each entry notes what is already in place.

## 2. Product rule constraints and a solver
**What:** Rules such as "ENGINE=V8 requires MARKET=US"; check a configuration's validity, grey out option values that can no longer be selected, list all buildable variants.
**Why:** Today an invalid combination (e.g. V8 + EU) silently yields an incomplete BOM.
**Notes:** This is a SAT problem; a solver (possibly compiled to WASM, inlined as base64 to keep `file://` working) would sit behind the `parse/validate/evaluate` interface in `src/expr.ts`.

## 3. Revisions and revision rules
**What:** Item revisions, with a rule such as "latest released" or "as of date" selecting which revision each occurrence resolves to.

## 7b. Graphical node-link view
**What:** Optional diagram view (the first version had one, replaced by the tree-table). Could return as a toggle for presentations.

## 8. Variant comparison
**What:** Diff the resolved structure of two configurations (added / removed / quantity-changed occurrences).

## 9. Command-line validator
**What:** Reuse `src/xml.ts` + `src/expr.ts` from Node to validate BOM XML in CI or PLM export pipelines. `DOMParser` would need a Node implementation (e.g. jsdom or `@xmldom/xmldom`).
