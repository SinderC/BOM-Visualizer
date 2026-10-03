import type { History } from './history';
import { findBom, type Bom, type BomDocument } from './model';
import type { ConfigContext, Occurrence } from './resolve';

export interface State {
  doc?: BomDocument; // undefined after File > Close
  bomId: string;
  fileName: string;
  ctx: ConfigContext;
  selected?: string; // occurrence address
  collapsed: Set<string>; // occurrence addresses
}

/** Shared handle passed to UI modules. Mutate state inside `commit` to trigger a re-render. */
export interface App {
  state: State;
  commit(mutate?: () => void): void;
  /** Like `commit`, but an error from `mutate` is shown as a toast; the re-render restores the edited field. */
  tryCommit(mutate: () => void): void;
  loadDocument(doc: BomDocument, fileName: string): void;
  closeDocument(): void;
  /** True when the document differs from what was last opened from or saved to file. */
  isDirty(): boolean;
  markSaved(): void;
  toast(message: string, isError?: boolean): void;
  /** Document undo/redo; steps are recorded by `commit`. Use as `app.commit(app.history.undo)`. */
  history: History;
  /** Occurrence lookup from the latest resolve, by address. */
  occurrence(address: string | undefined): Occurrence | undefined;
}

/** The open document. Only the toolbar renders without one, so other UI can rely on it. */
export function openDoc(state: State): BomDocument {
  if (!state.doc) throw new Error('No document is open');
  return state.doc;
}

export function activeBom(state: State): Bom {
  const doc = openDoc(state);
  return findBom(doc, state.bomId) ?? doc.boms[0];
}

/** Clears what is shown of the previous BOM or document: selection and collapsed rows. */
export function resetView(state: State): void {
  state.selected = undefined;
  state.collapsed.clear();
}

/** Creates an element with properties and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(el, rest);
  if (dataset) Object.assign(el.dataset, dataset);
  el.append(...children);
  return el;
}
