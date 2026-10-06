import { activeBom, openDoc, resetView, type App, type State } from '../app';
import { createDocument, type Bom } from '../model';
import { parseXml, serializeXml } from '../xml';
import { showItemTypesDialog, showStructureTypesDialog, showVariantFamiliesDialog, showUnsavedChangesDialog } from './dialogs';
import { button, h, isMac } from './dom';
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
    ...alignControl(app),
    fileName,
    repoLink(),
  );
  for (const trigger of container.querySelectorAll<HTMLButtonElement>(':scope > span > button')) {
    if (trigger.textContent === openMenu) (trigger.popoverTargetElement as HTMLElement | null)?.showPopover();
  }
}

/** GitHub mark linking to the source; a new tab, so an unsaved document is not left behind. */
function repoLink(): HTMLAnchorElement {
  const link = h('a', { className: 'repo-link', href: 'https://github.com/SinderC/BOM-Visualizer', target: '_blank', rel: 'noopener', title: 'Source on GitHub' });
  link.innerHTML =
    '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
  link.setAttribute('aria-label', 'Source on GitHub');
  return link;
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
  return switchItems;
}

/** Toolbar control left of the file name: a menu of BOMs to align with, or the way back while aligning. */
function alignControl(app: App): HTMLElement[] {
  if (!app.state.doc) return [];
  if (app.state.align) {
    return [button({ className: 'primary', title: 'Back to editing this BOM' }, () => app.commit(() => exitAlign(app.state)), 'Exit alignment view')];
  }
  const bom = activeBom(app.state);
  const others = app.state.doc.boms.filter((b) => b !== bom);
  if (!others.length) return [];
  const items = others.map((b) =>
    button({ title: `Show ${b.name || b.id} beside this BOM to align occurrences` }, () => app.commit(() => startAlign(app.state, bom, b)), b.name || b.id),
  );
  return [menu('Align with…', items)];
}

/** Aligns `bom` with `other`. An EBOM is always shown on the left, so aligning with one swaps the sides. */
function startAlign(state: State, bom: Bom, other: Bom): void {
  if (other.type !== 'EBOM' || bom.type === 'EBOM') {
    state.align = { bomId: other.id };
    return;
  }
  // The current selection moves with its BOM to the right.
  state.align = { bomId: bom.id, selected: state.selected, returnTo: bom.id };
  state.bomId = other.id;
  state.selected = undefined;
  state.extraSelected = [];
}

/** Leaves the alignment view for the BOM it was started from, keeping that BOM's selection. */
function exitAlign(state: State): void {
  const { returnTo, selected } = state.align!;
  state.align = undefined;
  if (returnTo === undefined) return;
  state.bomId = returnTo;
  state.selected = selected;
  state.extraSelected = [];
}

/** Menu entry with its keyboard shortcut right-aligned, as in native menus. */
function shortcutItem(label: string, shortcut: string, title: string, onClick: () => void): HTMLButtonElement {
  return button({ title }, onClick, h('span', {}, label), h('span', { className: 'muted' }, shortcut));
}

function editItems(app: App): HTMLElement[] {
  const { history } = app;
  const undo = shortcutItem('Undo', isMac ? '⌘Z' : 'Ctrl+Z', 'Undo the last change', () => app.commit(history.undo));
  const redo = shortcutItem('Redo', isMac ? '⇧⌘Z' : 'Ctrl+Y', 'Redo the last undone change', () => app.commit(history.redo));
  undo.disabled = !history.canUndo;
  redo.disabled = !history.canRedo;
  const types = button({ title: 'Add, rename and remove item types' }, () => showItemTypesDialog(app), 'Item types…');
  const families = button({ title: 'Add, rename and remove variant families and their values' }, () => showVariantFamiliesDialog(app), 'Variant families…');
  const structures = button({ title: 'Add, rename and remove BOMs' }, () => showStructureTypesDialog(app), 'Structure types…');
  types.disabled = structures.disabled = families.disabled = !app.state.doc;
  return [undo, redo, h('hr'), types, structures, families];
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
