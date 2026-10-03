import { activeBom, h, type App } from '../app';
import { addBom, createDocument } from '../model';
import { parseXml, serializeXml } from '../xml';
import { setThemePref, themePref, type ThemePref } from './theme';

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { title }, label);
  b.addEventListener('click', onClick);
  return b;
}

/** Dropdown using the Popover API, which provides outside-click and Escape dismissal. */
function menu(label: string, items: HTMLButtonElement[]): HTMLElement {
  const list = h('div', { className: 'menu-list', popover: 'auto' }, ...items);
  const trigger = h('button', { popoverTargetElement: list }, `${label} ▾`);
  list.addEventListener('beforetoggle', () => {
    const r = trigger.getBoundingClientRect();
    list.style.left = `${r.left}px`;
    list.style.top = `${r.bottom + 4}px`;
  });
  list.addEventListener('click', (e) => {
    if ((e.target as Element).closest('button')) list.hidePopover();
  });
  return h('span', {}, trigger, list);
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

  const bomSelect = h(
    'select',
    { name: 'bom-select', title: 'Active BOM' },
    ...state.doc.boms.map((b) => h('option', { value: b.id, selected: b.id === bom.id }, `${b.id}`)),
  );
  bomSelect.addEventListener('change', () => switchBom(app, bomSelect.value));

  const bomName = h('input', { name: 'bom-name', value: bom.name, title: 'BOM name' });
  bomName.addEventListener('change', () => app.commit(() => (bom.name = bomName.value.trim() || bom.name)));

  container.replaceChildren(
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
    h('span', { className: 'sep' }),
    h('label', { className: 'inline' }, 'BOM', bomSelect),
    bomName,
    button('+ BOM', 'Add a BOM to this document', () => switchBom(app, addBom(state.doc, 'New BOM').id)),
    h('span', { className: 'muted file-name' }, state.fileName),
    h('label', { className: 'inline' }, 'Theme', themeSelect()),
  );
}

function themeSelect(): HTMLSelectElement {
  const labels: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };
  const select = h(
    'select',
    { name: 'theme', title: 'Color theme' },
    ...Object.entries(labels).map(([value, label]) => h('option', { value, selected: value === themePref() }, label)),
  );
  select.addEventListener('change', () => setThemePref(select.value as ThemePref));
  return select;
}

function switchBom(app: App, bomId: string): void {
  app.commit(() => {
    app.state.bomId = bomId;
    app.state.selected = undefined;
    app.state.collapsed.clear();
  });
}
