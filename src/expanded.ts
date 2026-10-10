import type { Occurrence } from './resolve';

/**
 * Which tree rows are expanded, remembered in localStorage for the open document. By default only BOM roots are;
 * `toggled` holds the addresses, of any BOM, that differ from that default.
 */
const EXPANDED_KEY = 'bom-visualizer.expanded';

function readStored(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return []; // storage unavailable or corrupt: defaults
  }
}

/** As stored at start: reapplied once the document is restored from autosave. */
export const storedExpanded = readStored();
let toggled = new Set(storedExpanded);
let version = 0; // counts changes
let storedVersion = 0;

/** Changes whenever a row is expanded or collapsed. */
export const expandedVersion = () => version;

export const isExpanded = (occ: Occurrence) => (occ.path.length === 0) !== toggled.has(occ.address);

export function setExpanded(occ: Occurrence, expanded: boolean): void {
  if (isExpanded(occ) === expanded) return;
  if (!toggled.delete(occ.address)) toggled.add(occ.address);
  version++;
}

/** Back to the default, for another document; or to `toggled`, as stored. */
export function resetExpanded(addresses: string[] = []): void {
  toggled = new Set(addresses);
  version++;
}

/** Writes to localStorage when anything changed since the last write. */
export function storeExpanded(): void {
  if (storedVersion === version) return;
  storedVersion = version;
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...toggled]));
  } catch {
    // Storage unavailable or full: the rows stay expanded for the session.
  }
}
