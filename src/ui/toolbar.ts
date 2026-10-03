import { activeBom, h, openDoc, type App } from '../app';
import { addBom, createDocument } from '../model';
import { parseXml, serializeXml } from '../xml';
import { showNewBomDialog, showUnsavedChangesDialog } from './dialogs';
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

function menu(label: string, items: HTMLElement[], disabled = false): HTMLElement {
  const trigger = h('button', { disabled }, `${label} ▾`);
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
/** Save writes back to the opened file (Chromium: Chrome, Edge); elsewhere Save downloads a copy. */
export const canWrite = 'showSaveFilePicker' in window;

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

/**
 * Runs `proceed` once unsaved changes are saved or discarded. Asks only where Save writes back to the file; elsewhere
 * autosave is the safety net. Does nothing if the user cancels, or cancels or fails the save.
 */
function confirmUnsaved(app: App, proceed: () => void): void {
  if (!canWrite || !app.isDirty()) return proceed();
  showUnsavedChangesDialog(app.state.fileName, async (save) => {
    if (!save || (await saveFile(app))) proceed();
  });
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

/** Download fallback; counted as saved, since the browser gives no way to tell whether the user kept the file. */
function download(app: App): true {
  const url = URL.createObjectURL(new Blob([serializeXml(openDoc(app.state))], { type: 'application/xml' }));
  h('a', { href: url, download: app.state.fileName }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  app.markSaved();
  return true;
}

/** Returns whether the document was saved. */
async function saveFile(app: App, saveAs = false): Promise<boolean> {
  if (!window.showSaveFilePicker) return download(app);
  try {
    if (saveAs || !fileHandle) {
      fileHandle = await window.showSaveFilePicker({ suggestedName: app.state.fileName, types: XML_TYPES });
    }
    const writable = await fileHandle.createWritable();
    await writable.write(serializeXml(openDoc(app.state)));
    await writable.close();
    const { name } = fileHandle;
    app.commit(() => (app.state.fileName = name));
    app.markSaved();
    app.toast(`Saved ${name}`);
    return true;
  } catch (e) {
    if (!isAbort(e)) app.toast(`Could not save: ${(e as Error).message}`, true);
    return false;
  }
}

export function renderToolbar(container: HTMLElement, app: App): void {
  const { state } = app;
  const { doc } = state;
  const noDoc = !doc;

  const fileInput = h('input', { type: 'file', accept: '.xml,application/xml,text/xml', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void openFile(app, file);
  });

  const save = button('Save', canWrite ? `Save ${state.fileName}` : `Download as ${state.fileName}`, () => void saveFile(app));
  const saveAs = button('Save As…', 'Save to a new file', () => void saveFile(app, true));
  const close = button('Close', 'Close the document', () =>
    confirmUnsaved(app, () => {
      fileHandle = undefined;
      app.closeDocument();
    }),
  );
  save.disabled = saveAs.disabled = close.disabled = noDoc;
  const dirty = app.isDirty();
  const fileName = h('span', { className: 'muted file-name', title: dirty ? 'Unsaved changes' : '' }, (dirty ? '• ' : '') + state.fileName);

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
      button('New', 'Start an empty document', () =>
        confirmUnsaved(app, () => {
          fileHandle = undefined;
          app.loadDocument(createDocument(), 'untitled.xml');
        }),
      ),
      button('Open…', 'Open a BOM XML file', () => confirmUnsaved(app, () => void pickAndOpen(app, fileInput))),
      save,
      ...(canWrite ? [saveAs] : []),
      h('hr'),
      close,
    ]),
    fileInput,
    menu('Edit', editItems(app)),
    menu('BOM', doc ? bomItems(app) : [], noDoc),
    menu('View', viewItems(app)),
    h('span', { className: 'sep' }),
    ...(doc ? [bomNameInput(app)] : []),
    fileName,
  );
}

function bomItems(app: App): HTMLElement[] {
  const bom = activeBom(app.state);
  const doc = openDoc(app.state);
  const switchItems = doc.boms.map((b) => {
    const item = button('', `Switch to ${b.name || b.id}`, () => switchBom(app, b.id));
    if (b.id === bom.id) item.classList.add('active');
    item.append(h('span', {}, b.name || b.id), h('span', { className: 'muted' }, b.type ?? ''));
    return item;
  });
  return [
    ...switchItems,
    h('hr'),
    button('Create new BOM…', 'Add a BOM to this document', () =>
      showNewBomDialog((name, type) => switchBom(app, addBom(doc, name, type).id)),
    ),
  ];
}

function bomNameInput(app: App): HTMLInputElement {
  const bom = activeBom(app.state);
  const input = h('input', { name: 'bom-name', value: bom.name, title: 'BOM name' });
  input.addEventListener('change', () => app.commit(() => (bom.name = input.value.trim() || bom.name)));
  return input;
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
