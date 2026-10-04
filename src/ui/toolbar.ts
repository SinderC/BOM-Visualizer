import { activeBom, openDoc, resetView, type App } from '../app';
import { addBom, createDocument } from '../model';
import { parseXml, serializeXml } from '../xml';
import { showItemTypesDialog, showNewBomDialog, showVariantFamiliesDialog, showUnsavedChangesDialog } from './dialogs';
import { button, h, input } from './dom';
import { setThemePref, themePref, type ThemePref } from './theme';
import {
  COLUMNS,
  isBanded,
  isColumnShown,
  isHideExcluded,
  isPanelShown,
  setBanded,
  setColumnShown,
  setHideExcluded,
  setPanelShown,
  type Panel,
} from './view';

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
  const trigger = h('button', { className: 'menu-trigger', disabled }, label, h('span', { className: 'caret' }));
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
    h('span', { className: 'muted caret right' }),
  );
  const list = menuList(trigger, items, 'right');
  const open = () => list.matches(':popover-open') || list.showPopover();
  trigger.addEventListener('click', open);
  trigger.addEventListener('mouseenter', open);
  return h('span', { className: 'submenu' }, trigger, list);
}

/** Entry with a check mark column on the left, as in native menus. */
function checkItem(label: string, checked: boolean, title: string, onClick: () => void): HTMLButtonElement {
  return button({ className: 'check-item', title }, onClick, h('span', { className: 'check' }, checked ? '✓' : ''), h('span', {}, label));
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

  const save = button({ title: canWrite ? `Save ${state.fileName}` : `Download as ${state.fileName}` }, () => void saveFile(app), 'Save');
  const saveAs = button({ title: 'Save to a new file' }, () => void saveFile(app, true), 'Save As…');
  const close = button(
    { title: 'Close the document' },
    () =>
      confirmUnsaved(app, () => {
        fileHandle = undefined;
        app.closeDocument();
      }),
    'Close',
  );
  save.disabled = saveAs.disabled = close.disabled = noDoc;
  const dirty = app.isDirty();
  const fileName = h('span', { className: 'muted file-name', title: dirty ? 'Unsaved changes' : '' }, (dirty ? '• ' : '') + state.fileName);

  // A toggle that re-renders (Hide excluded rows) rebuilds the menus, so reopen the menu that was open.
  const openMenu = container.querySelector(':scope > span > .menu-list:popover-open')?.previousElementSibling?.textContent;
  container.replaceChildren(
    h('strong', { className: 'brand' }, 'BOM Visualizer'),
    menu('File', [
      button(
        { title: 'Start an empty document' },
        () =>
          confirmUnsaved(app, () => {
            fileHandle = undefined;
            app.loadDocument(createDocument(), 'untitled.xml');
          }),
        'New',
      ),
      button({ title: 'Open a BOM XML file' }, () => confirmUnsaved(app, () => void pickAndOpen(app, fileInput)), 'Open…'),
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
  for (const trigger of container.querySelectorAll<HTMLButtonElement>(':scope > span > button')) {
    if (trigger.textContent === openMenu) (trigger.popoverTargetElement as HTMLElement | null)?.showPopover();
  }
}

function bomItems(app: App): HTMLElement[] {
  const bom = activeBom(app.state);
  const doc = openDoc(app.state);
  const switchItems = doc.boms.map((b) =>
    button(
      { title: `Switch to ${b.name || b.id}`, className: b.id === bom.id ? 'active' : '' },
      () => switchBom(app, b.id),
      h('span', {}, b.name || b.id),
      h('span', { className: 'muted' }, b.type ?? ''),
    ),
  );
  const others = doc.boms.filter((b) => b !== bom);
  const alignItems = others.map((b) =>
    checkItem(b.name || b.id, app.state.align?.bomId === b.id, `Show ${b.name || b.id} beside this BOM to align occurrences`, () =>
      app.commit(() => (app.state.align = { bomId: b.id })),
    ),
  );
  const exitAlign = button({ title: 'Back to editing this BOM' }, () => app.commit(() => (app.state.align = undefined)), 'Exit alignment view');
  return [
    ...switchItems,
    h('hr'),
    ...(others.length ? [submenu('Align with', alignItems)] : []),
    ...(app.state.align ? [exitAlign] : []),
    button(
      { title: 'Add a BOM to this document' },
      () => showNewBomDialog((name, type) => switchBom(app, addBom(doc, name, type).id)),
      'Create new BOM…',
    ),
  ];
}

function bomNameInput(app: App): HTMLInputElement {
  const bom = activeBom(app.state);
  return input('bom-name', bom.name, (v) => app.commit(() => (bom.name = v || bom.name)), { title: 'BOM name' });
}

/** Menu entry with its keyboard shortcut right-aligned, as in native menus. */
function shortcutItem(label: string, shortcut: string, title: string, onClick: () => void): HTMLButtonElement {
  return button({ title }, onClick, h('span', {}, label), h('span', { className: 'muted' }, shortcut));
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function editItems(app: App): HTMLElement[] {
  const { history } = app;
  const undo = shortcutItem('Undo', isMac ? '⌘Z' : 'Ctrl+Z', 'Undo the last change', () => app.commit(history.undo));
  const redo = shortcutItem('Redo', isMac ? '⇧⌘Z' : 'Ctrl+Y', 'Redo the last undone change', () => app.commit(history.redo));
  undo.disabled = !history.canUndo;
  redo.disabled = !history.canRedo;
  const types = button({ title: 'Add, rename and remove item types' }, () => showItemTypesDialog(app), 'Item types…');
  const families = button({ title: 'Add, rename and remove variant families and their values' }, () => showVariantFamiliesDialog(app), 'Variant families…');
  types.disabled = families.disabled = !app.state.doc;
  return [undo, redo, h('hr'), types, families];
}

function viewItems(app: App): HTMLElement[] {
  const columns = COLUMNS.map((c) =>
    toggleItem(c.label, `Show or hide the ${c.label} column`, () => isColumnShown(c.key), (on) => setColumnShown(c.key, on)),
  );
  // Name holds the tree (indentation, expand/collapse, drag handle), so it is always shown.
  columns[0].disabled = true;
  const panel = (p: Panel, label: string, title: string) =>
    toggleItem(label, title, () => isPanelShown(p), (on) => setPanelShown(p, on));
  return [
    submenu('Theme', themeItems(app)),
    submenu('Columns', columns),
    toggleItem('Banded rows', 'Shade every other row', isBanded, setBanded),
    // Re-render: the tree-table leaves hidden rows out rather than hiding them with CSS.
    toggleItem('Hide excluded rows', 'Hide rows the applied configuration excludes', isHideExcluded, (on) =>
      app.commit(() => setHideExcluded(on)),
    ),
    h('hr'),
    panel('config', 'Configuration', 'Show or hide the configuration panel'),
    panel('editor', 'Editor', 'Show or hide the editor panel'),
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
    resetView(app.state);
  });
}
