import { COLUMNS } from './tree-table';

/** View options: banded rows and hidden tree-table columns. Applied with CSS, so toggling needs no re-render. */
const VIEW_KEY = 'bom-visualizer.view';

interface ViewPrefs {
  banded: boolean;
  hiddenColumns: string[]; // column keys
}

function readStored(): ViewPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Partial<ViewPrefs>;
    return { banded: !!v.banded, hiddenColumns: Array.isArray(v.hiddenColumns) ? v.hiddenColumns : [] };
  } catch {
    // Storage unavailable or corrupt: defaults.
    return { banded: false, hiddenColumns: [] };
  }
}

// Kept in memory too, so choices still apply for the session when storage is unavailable.
const prefs = readStored();
const columnStyle = document.head.appendChild(document.createElement('style'));

export function applyView(): void {
  document.documentElement.toggleAttribute('data-banded', prefs.banded);
  columnStyle.textContent = COLUMNS.map((c, i) =>
    prefs.hiddenColumns.includes(c.key) ? `.tree-table tr > :nth-child(${i + 1}) { display: none; }` : '',
  ).join('\n');
}

function store(): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(prefs));
  } catch {
    // See readStored.
  }
  applyView();
}

export const isBanded = () => prefs.banded;

export function setBanded(banded: boolean): void {
  prefs.banded = banded;
  store();
}

export const isColumnShown = (key: string) => !prefs.hiddenColumns.includes(key);

export function setColumnShown(key: string, shown: boolean): void {
  prefs.hiddenColumns = prefs.hiddenColumns.filter((k) => k !== key);
  if (!shown) prefs.hiddenColumns.push(key);
  store();
}
