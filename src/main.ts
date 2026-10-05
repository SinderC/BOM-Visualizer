import './styles.css';
import { activeBom, resetView, type App, type State } from './app';
import { loadAutosave, writeAutosave, type Autosaved } from './autosave';
import { createHistory } from './history';
import { findBom } from './model';
import { flatten, resolve, type Occurrence } from './resolve';
import sample from './samples/car.xml?raw';
import { createAlignmentView, renderAlignPanel } from './ui/alignment';
import { renderConfigPanel } from './ui/config-panel';
import { renderEditor } from './ui/editor';
import { initResizers } from './ui/resize';
import { canWrite, renderToolbar } from './ui/toolbar';
import { watchSystemTheme } from './ui/theme';
import { applyView, isApplyConfig } from './ui/view';
import { createTreeTable, editPane } from './ui/tree-table';
import { parseXml, serializeXml } from './xml';

const $ = (id: string) => document.getElementById(id)!;

const state: State = {
  doc: parseXml(sample),
  bomId: 'EBOM',
  fileName: 'car.xml',
  ctx: { enabled: isApplyConfig(), options: { ENGINE: 'V8', MARKET: 'US', TRIM: 'SPORT' } },
  extraSelected: [],
  collapsed: new Set(),
};

let index = new Map<string, Occurrence>();
const history = createHistory(
  () => (state.doc ? serializeXml(state.doc) : ''),
  (snapshot) => (state.doc = parseXml(snapshot)),
);
/** Snapshot as last opened from or saved to file; undefined = never saved (always dirty). */
let cleanSnapshot: string | undefined = history.snapshot;
let saved = ''; // JSON of the last autosave
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
  tryCommit(mutate) {
    try {
      app.commit(mutate);
    } catch (e) {
      app.toast((e as Error).message, true);
      app.commit();
    }
  },
  loadDocument(doc, fileName) {
    state.doc = doc;
    state.bomId = doc.boms[0].id;
    state.fileName = fileName;
    resetView(state);
    state.ctx.options = {};
    resetDocument();
  },
  closeDocument() {
    state.doc = undefined;
    state.fileName = '';
    resetView(state);
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

/**
 * Writes the document, its file name, its unsaved state and the configuration to localStorage when any changed;
 * reports a failure once.
 */
function autosave(): void {
  const { options, date, unit } = state.ctx;
  const current: Autosaved = { fileName: state.fileName, xml: history.snapshot, dirty: app.isDirty(), config: { options, date, unit } };
  const json = JSON.stringify(current);
  if (json === saved) return;
  const error = writeAutosave(current);
  if (error && !autosaveFailed) app.toast(`Autosave failed: ${error}`, true);
  autosaveFailed = !!error;
  if (!error) saved = json;
}

const treeTable = createTreeTable($('tree'), app, editPane(app));
const alignmentView = createAlignmentView($('tree'), app);

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
  const bom = activeBom(state);
  // The aligned BOM can vanish on undo of its creation.
  const alignBom = state.align && state.align.bomId !== bom.id ? findBom(state.doc, state.align.bomId) : undefined;
  if (!alignBom) state.align = undefined;
  const root = resolve(state.doc, bom, state.ctx);
  const alignRoot = alignBom && resolve(state.doc, alignBom, state.ctx);
  // Addresses start with the BOM id, so one index serves both panes.
  index = new Map([root, alignRoot].flatMap((r) => (r ? flatten(r) : [])).map((o) => [o.address, o]));
  if (state.selected && !index.has(state.selected)) state.selected = undefined;
  state.extraSelected = state.selected ? state.extraSelected.filter((a) => index.has(a) && a !== state.selected) : [];
  if (state.align?.selected && !index.has(state.align.selected)) state.align.selected = undefined;

  document.body.classList.toggle('aligning', !!alignRoot);
  if (alignRoot) {
    alignmentView.render(root, alignRoot);
    renderAlignPanel($('editor'), app, root, alignRoot);
  } else {
    treeTable.render(root);
    renderEditor($('editor'), app);
  }
  renderConfigPanel($('config-panel'), app, root);

  if (focusedName) document.querySelector<HTMLElement>(`[name="${CSS.escape(focusedName)}"]`)?.focus();
}

// Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Ctrl+Y; text fields keep their own undo.
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  // In a dialog, undo would change the document behind it and leave the dialog showing old data.
  if ((e.target as HTMLElement).closest('input, textarea, dialog')) return;
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
initResizers();
render();

const restored = loadAutosave();
if (restored) {
  try {
    if (!restored.xml) app.closeDocument();
    else {
      app.loadDocument(parseXml(restored.xml), restored.fileName);
      Object.assign(state.ctx, restored.config);
      if (restored.dirty ?? true) cleanSnapshot = undefined;
      app.commit();
      app.toast(`Restored ${restored.fileName} from autosave`);
    }
  } catch (e) {
    app.toast(`Could not restore autosave: ${(e as Error).message}`, true);
  }
}
