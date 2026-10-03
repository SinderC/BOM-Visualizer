import './styles.css';
import { activeBom, type App, type State } from './app';
import { resolve, type Occurrence } from './resolve';
import sample from './samples/car.xml?raw';
import { renderConfigPanel } from './ui/config-panel';
import { renderEditor } from './ui/editor';
import { renderToolbar } from './ui/toolbar';
import { watchSystemTheme } from './ui/theme';
import { createTreeTable } from './ui/tree-table';
import { parseXml } from './xml';

const $ = (id: string) => document.getElementById(id)!;

const state: State = {
  doc: parseXml(sample),
  bomId: 'EBOM',
  fileName: 'car.xml',
  ctx: { enabled: true, options: { ENGINE: 'V8', MARKET: 'US', TRIM: 'SPORT' } },
  collapsed: new Set(),
};

let index = new Map<string, Occurrence>();
let renderQueued = false;
let toastTimer: number | undefined;

const app: App = {
  state,
  commit(mutate) {
    mutate?.();
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
  renderConfigPanel($('config-panel'), app, root);
  renderEditor($('editor'), app);

  if (focusedName) document.querySelector<HTMLElement>(`[name="${CSS.escape(focusedName)}"]`)?.focus();
}

watchSystemTheme();
render();
