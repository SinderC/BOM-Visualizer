import './styles.css';
import { activeBom, type App, type State } from './app';
import { loadAutosave, writeAutosave, type Autosaved } from './autosave';
import { createHistory } from './history';
import { resolve, type Occurrence } from './resolve';
import sample from './samples/car.xml?raw';
import { renderConfigPanel } from './ui/config-panel';
import { renderEditor } from './ui/editor';
import { canWrite, renderToolbar } from './ui/toolbar';
import { watchSystemTheme } from './ui/theme';
import { applyView, isApplyConfig } from './ui/view';
import { createTreeTable } from './ui/tree-table';
import { parseXml, serializeXml } from './xml';

const $ = (id: string) => document.getElementById(id)!;

const state: State = {
  doc: parseXml(sample),
  bomId: 'EBOM',
  fileName: 'car.xml',
  ctx: { enabled: isApplyConfig(), options: { ENGINE: 'V8', MARKET: 'US', TRIM: 'SPORT' } },
  collapsed: new Set(),
};

let index = new Map<string, Occurrence>();
const history = createHistory(
  () => (state.doc ? serializeXml(state.doc) : ''),
  (snapshot) => (state.doc = parseXml(snapshot)),
);
/** Snapshot as last opened from or saved to file; undefined = never saved (always dirty). */
let cleanSnapshot: string | undefined = history.snapshot;
let saved: Autosaved = { fileName: state.fileName, xml: history.snapshot, dirty: false }; // last autosaved state
let autosaveFailed = false;
let renderQueued = false;
let toastTimer: number | undefined;

const app: App = {
  state,
  commit(mutate) {
    mutate?.();
    history.record();
    autosave();
    // Deferred so that focus has moved (e.g. Tab after a change event) before panels are rebuilt.
    if (!renderQueued) {
      renderQueued = true;
      setTimeout(render);
    }
  },
  loadDocument(doc, fileName) {
    state.doc = doc;
    state.bomId = doc.boms[0].id;
    state.fileName = fileName;
    state.selected = undefined;
    state.collapsed.clear();
    state.ctx.options = {};
    resetDocument();
  },
  closeDocument() {
    state.doc = undefined;
    state.fileName = '';
    state.selected = undefined;
    state.collapsed.clear();
    resetDocument();
  },
  isDirty: () => history.snapshot !== cleanSnapshot,
  markSaved() {
    cleanSnapshot = history.snapshot;
    app.commit();
  },
  toast(message, isError = false) {
    const el = $('toast');
    el.textContent = message;
    el.className = isError ? 'error' : '';
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), isError ? 6000 : 2500);
  },
  history,
  occurrence: (address) => (address === undefined ? undefined : index.get(address)),
};

/** After opening, creating or closing a document: no undo steps, nothing unsaved. */
function resetDocument(): void {
  history.reset();
  cleanSnapshot = history.snapshot;
  app.commit();
}

/** Writes the document to localStorage when it, its file name or its unsaved state changed; reports a failure once. */
function autosave(): void {
  const current: Autosaved = { fileName: state.fileName, xml: history.snapshot, dirty: app.isDirty() };
  if (current.xml === saved.xml && current.fileName === saved.fileName && current.dirty === saved.dirty) return;
  const error = writeAutosave(current);
  if (error && !autosaveFailed) app.toast(`Autosave failed: ${error}`, true);
  autosaveFailed = !!error;
  if (!error) saved = current;
}

const treeTable = createTreeTable($('tree'), app);

function render(): void {
  renderQueued = false;
  const focusedName = (document.activeElement as HTMLInputElement | null)?.name;
  renderToolbar($('toolbar'), app);
  document.title = state.doc ? `${app.isDirty() ? '• ' : ''}${state.fileName} - BOM Visualizer` : 'BOM Visualizer';
  // Without a document, CSS hides the panels and the tree, and shows the placeholder.
  document.body.classList.toggle('no-doc', !state.doc);
  if (!state.doc) {
    index = new Map();
    return;
  }
  const root = resolve(state.doc, activeBom(state), state.ctx);
  index = new Map();
  const walk = (o: Occurrence) => {
    index.set(o.address, o);
    o.children.forEach(walk);
  };
  walk(root);
  if (state.selected && !index.has(state.selected)) state.selected = undefined;

  treeTable.render(root);
  renderConfigPanel($('config-panel'), app, root);
  renderEditor($('editor'), app);

  if (focusedName) document.querySelector<HTMLElement>(`[name="${CSS.escape(focusedName)}"]`)?.focus();
}

// Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Ctrl+Y; text fields keep their own undo.
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  if ((e.target as HTMLElement).closest('input, textarea')) return;
  const key = e.key.toLowerCase();
  const redo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
  if (key !== 'z' && !redo) return;
  e.preventDefault();
  app.commit(redo ? history.redo : history.undo);
});

// Browser's own "Leave site?" prompt; only where Save can write back to the file (Chromium).
addEventListener('beforeunload', (e) => {
  if (canWrite && app.isDirty()) e.preventDefault();
});

watchSystemTheme();
applyView();
render();

const restored = loadAutosave();
if (restored) {
  try {
    if (!restored.xml) app.closeDocument();
    else {
      app.loadDocument(parseXml(restored.xml), restored.fileName);
      if (restored.dirty ?? true) {
        cleanSnapshot = undefined;
        app.commit();
      }
      app.toast(`Restored ${restored.fileName} from autosave`);
    }
  } catch (e) {
    app.toast(`Could not restore autosave: ${(e as Error).message}`, true);
  }
}
