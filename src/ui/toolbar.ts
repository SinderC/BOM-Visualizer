import { activeBom, h, type App } from '../app';
import { addBom, createDocument } from '../model';
import { parseXml, serializeXml } from '../xml';
import { showNewBomDialog } from './dialogs';
import { storeShowConfig } from './sidebar';
import { setThemePref, themePref, type ThemePref } from './theme';
import { COLUMNS } from './tree-table';
import { isBanded, isColumnShown, setBanded, setColumnShown } from './view';

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { title }, label);
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Menu list using the Popover API, which provides outside-click and Escape dismissal. Clicking an entry closes the
 * menu unless the entry has `data-keep-open` (submenu triggers, toggles).
 */
function menuList(trigger: HTMLElement, items: HTMLElement[], place: 'below' | 'right'): HTMLElement {
  const list = h('div', { className: 'menu-list', popover: 'auto' }, ...items);
  list.addEventListener('beforetoggle', () => {
    const r = trigger.getBoundingClientRect();
    list.style.left = `${place === 'below' ? r.left : r.right + 2}px`;
    list.style.top = `${place === 'below' ? r.bottom + 4 : r.top - 5}px`;
  });
  list.addEventListener('click', (e) => {
    const item = (e.target as Element).closest('button');
    if (item && !('keepOpen' in item.dataset)) list.hidePopover();
  });
  return list;
}

function menu(label: string, items: HTMLElement[]): HTMLElement {
  const trigger = h('button', {}, `${label} ▾`);
  const list = menuList(trigger, items, 'below');
  trigger.popoverTargetElement = list;
  return h('span', {}, trigger, list);
}

/**
 * Entry that opens a nested menu to its right, on hover or click. Nested in the parent list so both stay open.
 * Has an empty check column so its label lines up with check items in the same menu.
 */
function submenu(label: string, items: HTMLElement[]): HTMLElement {
  const trigger = h(
    'button',
    { className: 'check-item', dataset: { keepOpen: '' } },
    h('span', { className: 'check' }),
    h('span', {}, label),
    h('span', { className: 'muted arrow' }, '▸'),
  );
  const list = menuList(trigger, items, 'right');
  const open = () => list.matches(':popover-open') || list.showPopover();
  trigger.addEventListener('click', open);
  trigger.addEventListener('mouseenter', open);
  return h('span', { className: 'submenu' }, trigger, list);
}

/** Entry with a check mark column on the left, as in native menus. */
function checkItem(label: string, checked: boolean, title: string, onClick: () => void): HTMLButtonElement {
  const item = button('', title, onClick);
  item.classList.add('check-item');
  item.append(h('span', { className: 'check' }, checked ? '✓' : ''), h('span', {}, label));
  return item;
}

/** Check item that flips a view setting in place, keeping the menu open. */
function toggleItem(label: string, title: string, get: () => boolean, set: (on: boolean) => void): HTMLButtonElement {
  const item = checkItem(label, get(), title, () => {
    set(!get());
    item.querySelector('.check')!.textContent = get() ? '✓' : '';
  });
  item.dataset.keepOpen = '';
  return item;
}

// File System Access API (Chromium only); not yet in TypeScript's DOM lib.
interface PickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
declare global {
  interface Window {
    showOpenFilePicker?(options?: PickerOptions): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?(options?: PickerOptions): Promise<FileSystemFileHandle>;
  }
}

const XML_TYPES = [{ description: 'BOM XML', accept: { 'application/xml': ['.xml'] } }];
const canWrite = 'showSaveFilePicker' in window;

/** File that Save writes back to; unset until the document is opened from or saved to disk. */
let fileHandle: FileSystemFileHandle | undefined;

const isAbort = (e: unknown) => (e as Error).name === 'AbortError';

async function openFile(app: App, file: File): Promise<boolean> {
  try {
    app.loadDocument(parseXml(await file.text()), file.name);
    app.toast(`Opened ${file.name}`);
    return true;
  } catch (e) {
    app.toast(`Could not open ${file.name}: ${(e as Error).message}`, true);
    return false;
  }
}

async function pickAndOpen(app: App, fileInput: HTMLInputElement): Promise<void> {
  if (!window.showOpenFilePicker) return fileInput.click();
  try {
    const [handle] = await window.showOpenFilePicker({ types: XML_TYPES });
    if (await openFile(app, await handle.getFile())) fileHandle = handle;
  } catch (e) {
    if (!isAbort(e)) app.toast(`Could not open file: ${(e as Error).message}`, true);
  }
}

function download(app: App): void {
  const url = URL.createObjectURL(new Blob([serializeXml(app.state.doc)], { type: 'application/xml' }));
  h('a', { href: url, download: app.state.fileName }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveFile(app: App, saveAs = false): Promise<void> {
  if (!window.showSaveFilePicker) return download(app);
  try {
    if (saveAs || !fileHandle) {
      fileHandle = await window.showSaveFilePicker({ suggestedName: app.state.fileName, types: XML_TYPES });
    }
    const writable = await fileHandle.createWritable();
    await writable.write(serializeXml(app.state.doc));
    await writable.close();
    const { name } = fileHandle;
    app.commit(() => (app.state.fileName = name));
    app.toast(`Saved ${name}`);
  } catch (e) {
    if (!isAbort(e)) app.toast(`Could not save: ${(e as Error).message}`, true);
  }
}

export function renderToolbar(container: HTMLElement, app: App): void {
  const { state } = app;
  const bom = activeBom(state);

  const fileInput = h('input', { type: 'file', accept: '.xml,application/xml,text/xml', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void openFile(app, file);
  });

  const bomItems = state.doc.boms.map((b) => {
    const item = button('', `Switch to ${b.name || b.id}`, () => switchBom(app, b.id));
    if (b.id === bom.id) item.classList.add('active');
    item.append(h('span', {}, b.name || b.id), h('span', { className: 'muted' }, b.type ?? ''));
    return item;
  });

  const bomName = h('input', { name: 'bom-name', value: bom.name, title: 'BOM name' });
  bomName.addEventListener('change', () => app.commit(() => (bom.name = bomName.value.trim() || bom.name)));

  const sidebarToggle = button('☰', 'Show or hide the configuration sidebar', () =>
    app.commit(() => storeShowConfig((state.showConfig = !state.showConfig))),
  );
  sidebarToggle.classList.add('icon');
  sidebarToggle.classList.toggle('active', state.showConfig);
  sidebarToggle.setAttribute('aria-pressed', String(state.showConfig));

  container.replaceChildren(
    sidebarToggle,
    h('strong', { className: 'brand' }, 'BOM Visualizer'),
    menu('File', [
      button('New', 'Start an empty document', () => {
        fileHandle = undefined;
        app.loadDocument(createDocument(), 'untitled.xml');
      }),
      button('Open…', 'Open a BOM XML file', () => void pickAndOpen(app, fileInput)),
      button('Save', canWrite ? `Save ${state.fileName}` : `Download as ${state.fileName}`, () => void saveFile(app)),
      ...(canWrite ? [button('Save As…', 'Save to a new file', () => void saveFile(app, true))] : []),
    ]),
    fileInput,
    menu('Edit', editItems(app)),
    menu('BOM', [
      ...bomItems,
      h('hr'),
      button('Create new BOM…', 'Add a BOM to this document', () =>
        showNewBomDialog((name, type) => switchBom(app, addBom(state.doc, name, type).id)),
      ),
    ]),
    menu('View', viewItems(app)),
    h('span', { className: 'sep' }),
    bomName,
    h('span', { className: 'muted file-name' }, state.fileName),
  );
}

/** Menu entry with its keyboard shortcut right-aligned, as in native menus. */
function shortcutItem(label: string, shortcut: string, title: string, onClick: () => void): HTMLButtonElement {
  const item = button('', title, onClick);
  item.append(h('span', {}, label), h('span', { className: 'muted' }, shortcut));
  return item;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function editItems(app: App): HTMLButtonElement[] {
  const { history } = app;
  const undo = shortcutItem('Undo', isMac ? '⌘Z' : 'Ctrl+Z', 'Undo the last change', () => app.commit(history.undo));
  const redo = shortcutItem('Redo', isMac ? '⇧⌘Z' : 'Ctrl+Y', 'Redo the last undone change', () => app.commit(history.redo));
  undo.disabled = !history.canUndo;
  redo.disabled = !history.canRedo;
  return [undo, redo];
}

function viewItems(app: App): HTMLElement[] {
  const columns = COLUMNS.map((c) =>
    toggleItem(c.label, `Show or hide the ${c.label} column`, () => isColumnShown(c.key), (on) => setColumnShown(c.key, on)),
  );
  // Name holds the tree (indentation, expand/collapse, drag handle), so it is always shown.
  columns[0].disabled = true;
  return [
    submenu('Theme', themeItems(app)),
    submenu('Columns', columns),
    toggleItem('Banded rows', 'Shade every other row', isBanded, setBanded),
  ];
}

function themeItems(app: App): HTMLButtonElement[] {
  const labels: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };
  return Object.entries(labels).map(([value, label]) =>
    // Re-render so the menu shows the new choice.
    checkItem(label, value === themePref(), `Use the ${label.toLowerCase()} color theme`, () => {
      setThemePref(value as ThemePref);
      app.commit();
    }),
  );
}

function switchBom(app: App, bomId: string): void {
  app.commit(() => {
    app.state.bomId = bomId;
    app.state.selected = undefined;
    app.state.collapsed.clear();
  });
}
