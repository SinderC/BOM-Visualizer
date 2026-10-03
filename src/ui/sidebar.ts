/** Remembers whether the configuration sidebar is shown. Absent = shown. */
const SIDEBAR_KEY = 'bom-visualizer.showConfig';

export function storedShowConfig(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false';
  } catch {
    // Storage unavailable (e.g. private mode): default to shown.
    return true;
  }
}

export function storeShowConfig(show: boolean): void {
  try {
    if (show) localStorage.removeItem(SIDEBAR_KEY);
    else localStorage.setItem(SIDEBAR_KEY, 'false');
  } catch {
    // See storedShowConfig; the choice still applies for this session via state.
  }
}
