/** Working copy kept in localStorage so the document survives reloads. One per origin; the last tab to write wins. */
const AUTOSAVE_KEY = 'bom-visualizer.autosave';

export interface Autosaved {
  fileName: string;
  xml: string;
}

export function loadAutosave(): Autosaved | undefined {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as Autosaved) : undefined;
  } catch {
    return undefined; // storage unavailable or corrupt: start from the sample
  }
}

/** Returns the error message if the write failed (storage unavailable or quota exceeded). */
export function writeAutosave(data: Autosaved): string | undefined {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}
