import { activeBom, h, type App } from '../app';
import { addBom, createDocument } from '../model';
import { parseXml, serializeXml } from '../xml';
import { setThemePref, themePref, type ThemePref } from './theme';

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { title }, label);
  b.addEventListener('click', onClick);
  return b;
}

async function openFile(app: App, file: File): Promise<void> {
  try {
    app.loadDocument(parseXml(await file.text()), file.name);
    app.toast(`Opened ${file.name}`);
  } catch (e) {
    app.toast(`Could not open ${file.name}: ${(e as Error).message}`, true);
  }
}

function saveFile(app: App): void {
  const url = URL.createObjectURL(new Blob([serializeXml(app.state.doc)], { type: 'application/xml' }));
  h('a', { href: url, download: app.state.fileName }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderToolbar(container: HTMLElement, app: App): void {
  const { state } = app;
  const bom = activeBom(state);

  const fileInput = h('input', { type: 'file', accept: '.xml,application/xml,text/xml', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
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
    button('New', 'Start an empty document', () => app.loadDocument(createDocument(), 'untitled.xml')),
    button('Open…', 'Open a BOM XML file', () => fileInput.click()),
    button('Save', `Download as ${state.fileName}`, () => saveFile(app)),
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
