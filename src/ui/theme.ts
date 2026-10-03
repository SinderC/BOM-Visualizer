export type ThemePref = 'system' | 'light' | 'dark';

/** Must match the key read by the inline script in index.html. Absent = follow system. */
const THEME_KEY = 'bom-visualizer.theme';
const systemDark = matchMedia('(prefers-color-scheme: dark)');

function readStored(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // Storage unavailable (e.g. private mode): fall back to system.
  }
  return 'system';
}

// Kept in memory too, so a choice still applies for the session when storage is unavailable.
let pref = readStored();

function apply(): void {
  const dark = pref === 'system' ? systemDark.matches : pref === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function themePref(): ThemePref {
  return pref;
}

export function setThemePref(next: ThemePref): void {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch {
    // See readStored.
  }
  apply();
}

/** Re-applies the theme when the OS setting changes while following the system. */
export function watchSystemTheme(): void {
  systemDark.addEventListener('change', () => pref === 'system' && apply());
}
