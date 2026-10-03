import { findBom, type Bom, type BomDocument } from './model';
import type { ConfigContext, Occurrence } from './resolve';

export interface State {
  doc: BomDocument;
  bomId: string;
  fileName: string;
  ctx: ConfigContext;
  selected?: string; // occurrence address
  collapsed: Set<string>; // occurrence addresses
  showConfig: boolean; // configuration sidebar visible
}

/** Shared handle passed to UI modules. Mutate state inside `commit` to trigger a re-render. */
export interface App {
  state: State;
  commit(mutate?: () => void): void;
  loadDocument(doc: BomDocument, fileName: string): void;
  toast(message: string, isError?: boolean): void;
  /** Occurrence lookup from the latest resolve, by address. */
  occurrence(address: string | undefined): Occurrence | undefined;
}

export function activeBom(state: State): Bom {
  return findBom(state.doc, state.bomId) ?? state.doc.boms[0];
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
