import { COLUMNS } from './tree-table';

/**
 * View options remembered in localStorage: side panels, banded rows and tree-table columns (applied with CSS, so
 * toggling needs no re-render), whether the configuration is applied (read into state at start) and whether rows it
 * excludes are hidden (read by the tree-table when rendering).
 */
const VIEW_KEY = 'bom-visualizer.view';

export type Panel = 'config' | 'families' | 'editor';

interface ViewPrefs {
  banded: boolean;
  hiddenColumns: string[]; // column keys
  hiddenPanels: Panel[];
  applyConfig: boolean;
  hideExcluded: boolean;
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v : []);

function readStored(): ViewPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Partial<ViewPrefs>;
    return {
      banded: !!v.banded,
      hiddenColumns: list(v.hiddenColumns),
      hiddenPanels: list(v.hiddenPanels),
      applyConfig: v.applyConfig !== false,
      hideExcluded: !!v.hideExcluded,
    };
  } catch {
    // Storage unavailable or corrupt: defaults.
    return { banded: false, hiddenColumns: [], hiddenPanels: [], applyConfig: true, hideExcluded: false };
  }
}

// Kept in memory too, so choices still apply for the session when storage is unavailable.
const prefs = readStored();
const columnStyle = document.head.appendChild(document.createElement('style'));

export function applyView(): void {
  const root = document.documentElement;
  root.toggleAttribute('data-banded', prefs.banded);
  for (const p of ['config', 'families', 'editor'] as const) root.toggleAttribute(`data-hide-${p}`, prefs.hiddenPanels.includes(p));
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

export const isPanelShown = (panel: Panel) => !prefs.hiddenPanels.includes(panel);

export function setPanelShown(panel: Panel, shown: boolean): void {
  prefs.hiddenPanels = prefs.hiddenPanels.filter((p) => p !== panel);
  if (!shown) prefs.hiddenPanels.push(panel);
  store();
}

export const isApplyConfig = () => prefs.applyConfig;

export function setApplyConfig(apply: boolean): void {
  prefs.applyConfig = apply;
  store();
}

export const isHideExcluded = () => prefs.hideExcluded;

export function setHideExcluded(hide: boolean): void {
  prefs.hideExcluded = hide;
  store();
}
