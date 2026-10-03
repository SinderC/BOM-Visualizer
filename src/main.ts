import './styles.css';
import { activeBom, type App, type State } from './app';
import { createHistory } from './history';
import { resolve, type Occurrence } from './resolve';
import sample from './samples/car.xml?raw';
import { renderConfigPanel } from './ui/config-panel';
import { renderEditor } from './ui/editor';
import { storedShowConfig } from './ui/sidebar';
import { renderToolbar } from './ui/toolbar';
import { watchSystemTheme } from './ui/theme';
import { createTreeTable } from './ui/tree-table';
import { parseXml, serializeXml } from './xml';

const $ = (id: string) => document.getElementById(id)!;

const state: State = {
  doc: parseXml(sample),
  bomId: 'EBOM',
  fileName: 'car.xml',
  ctx: { enabled: true, options: { ENGINE: 'V8', MARKET: 'US', TRIM: 'SPORT' } },
  collapsed: new Set(),
  showConfig: storedShowConfig(),
};

let index = new Map<string, Occurrence>();
const history = createHistory(
  () => serializeXml(state.doc),
  (snapshot) => (state.doc = parseXml(snapshot)),
);
let renderQueued = false;
let toastTimer: number | undefined;

const app: App = {
  state,
  commit(mutate) {
    mutate?.();
    history.record();
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
    history.reset();
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

const treeTable = createTreeTable($('tree'), app);

function render(): void {
  renderQueued = false;
  const focusedName = (document.activeElement as HTMLInputElement | null)?.name;
  const root = resolve(state.doc, activeBom(state), state.ctx);
  index = new Map();
  const walk = (o: Occurrence) => {
    index.set(o.address, o);
    o.children.forEach(walk);
  };
  walk(root);
  if (state.selected && !index.has(state.selected)) state.selected = undefined;

  treeTable.render(root);
  renderToolbar($('toolbar'), app);
  $('config-panel').hidden = !state.showConfig;
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

watchSystemTheme();
render();
