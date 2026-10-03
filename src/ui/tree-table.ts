import { activeBom, h, openDoc, type App } from '../app';
import { formatEff } from '../effectivity';
import { validate } from '../expr';
import { copyRelation, moveRelation, occurrencePath, parseQty, renameItem, updateItem, updateRelation } from '../model';
import type { Occurrence } from '../resolve';
import { typeSelect } from './editor';
import { COLUMNS, isColumnShown, isHideExcluded } from './view';

const INDENT = 18;

/** Indented tree-table (structure-manager style) with collapse, selection and keyboard navigation. */
export function createTreeTable(container: HTMLElement, app: App) {
  let visible: Occurrence[] = []; // rows in display order, for keyboard navigation
  const tbody = h('tbody');
  const table = h(
    'table',
    { className: 'tree-table', tabIndex: 0 },
    h('thead', {}, h('tr', {}, ...COLUMNS.map((c) => h('th', {}, c.label)), h('th', { className: 'filler' }))),
    tbody,
  );
  container.append(table);

  const select = (address: string | undefined) => app.commit(() => (app.state.selected = address));
  const setCollapsed = (address: string, collapse: boolean) =>
    app.commit(() => (collapse ? app.state.collapsed.add(address) : app.state.collapsed.delete(address)));

  table.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const address = target.closest('tr')?.dataset.address;
    if (!address) return;
    if (target.closest('.twisty')) setCollapsed(address, !app.state.collapsed.has(address));
    else select(address);
  });

  // Double-click a cell to edit its value in place. Enter or leaving the field saves, Escape cancels,
  // Tab / Shift+Tab saves and edits the next editable cell to the right / left, wrapping to the next / previous row.
  table.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    const td = target.closest('td');
    const address = td?.closest('tr')?.dataset.address;
    const col = td?.dataset.col;
    // Deferred past the re-render queued by the first click's selection, which would replace the cell.
    if (address && col && !target.closest('.twisty, input, select')) setTimeout(() => startEdit(address, col));
  });

  function startEdit(address: string, col: string): void {
    const occ = app.occurrence(address);
    const td = tbody.querySelector<HTMLElement>(`tr[data-address="${CSS.escape(address)}"] td[data-col="${col}"]`);
    const save = occ && cellSaver(app, occ, col);
    if (!td || !save) return;
    td.closest('tr')!.draggable = false; // so dragging selects text in the field
    // The name cell keeps its indent and twisty.
    const host = col === 'name' ? (td.lastElementChild as HTMLElement) : td;
    const width = `${Math.max(host.offsetWidth + 16, 80)}px`;
    const done = () => table.focus(); // blurs the field, which saves or restores it
    const keydown = (ke: KeyboardEvent, cancel?: () => void) => {
      ke.stopPropagation(); // keep arrows and undo for the field
      if (ke.key === 'Escape') cancel?.();
      if (ke.key === 'Escape' || ke.key === 'Enter') done();
      if (ke.key !== 'Tab') return;
      ke.preventDefault();
      const step = ke.shiftKey ? -1 : 1;
      let next = { address, col: nextEditable(app, occ, col, step) };
      if (!next.col) {
        const row = visible[visible.findIndex((o) => o.address === address) + step];
        next = { address: row?.address, col: row && nextEditable(app, row, undefined, step) };
      }
      done();
      if (!next.col) return;
      if (next.address !== address) select(next.address);
      setTimeout(() => startEdit(next.address, next.col!)); // after the save's re-render
    };

    if (col === 'type') {
      const picker = typeSelect(app, '', occ.item.type, (t) => updateItem(openDoc(app.state), occ.item.id, { type: t }));
      picker.addEventListener('keydown', (ke) => keydown(ke));
      picker.addEventListener('change', done);
      picker.addEventListener('blur', () => app.commit()); // restores the cell when nothing was picked
      return edit(host, picker, width);
    }

    const field = h('input', { className: 'mono', value: host.textContent ?? '', spellcheck: false });
    let cancelled = false;
    field.addEventListener('keydown', (ke) => keydown(ke, () => (cancelled = true)));
    field.addEventListener('blur', () => (cancelled ? app.commit() : app.tryCommit(() => save(field.value.trim()))));
    edit(host, field, width);
    field.select();
  }

  // Drag a row onto another row to make it a child there, or onto a row's top/bottom edge to place it before/after
  // that row as a sibling. Holding Ctrl or Alt/Option when dropping copies the relation instead of moving it.
  type Mode = 'into' | 'before' | 'after';
  let dragged: Occurrence | undefined;
  let dropRow: HTMLElement | undefined;
  const setDropRow = (row: HTMLElement | undefined, mode?: Mode) => {
    dropRow?.classList.remove('drop-into', 'drop-before', 'drop-after');
    dropRow = row;
    row?.classList.add(`drop-${mode}`);
  };
  const isCopy = (e: DragEvent) => e.ctrlKey || e.altKey;

  /** Where a drop at the pointer would place the dragged row, or undefined if not allowed. Other cycles are caught by the model. */
  const dropTargetAt = (e: DragEvent) => {
    const row = (e.target as HTMLElement).closest('tr');
    const target = app.occurrence(row?.dataset.address);
    const rel = dragged?.relation;
    if (!row || !target || !dragged || !rel) return undefined;
    const { top, height } = row.getBoundingClientRect();
    const y = (e.clientY - top) / height;
    const mode: Mode = !target.relation ? 'into' : y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
    const copy = isCopy(e);

    if (target.address.startsWith(`${dragged.address}/`)) return undefined;
    if (target.address === dragged.address && (mode === 'into' || !copy)) return undefined;
    if (mode === 'into' && !copy && target.item.id === rel.parentId) return undefined;

    const parentPath = mode === 'into' ? target.path : target.path.slice(0, -1);
    const parent = app.occurrence(occurrencePath(activeBom(app.state).id, parentPath))!;
    const siblings = parent.children;
    const beforeId =
      mode === 'before' ? target.relation!.id : mode === 'after' ? siblings[siblings.indexOf(target) + 1]?.relation!.id : undefined;
    return { row, mode, copy, parent, beforeId };
  };

  table.addEventListener('dragstart', (e) => {
    dragged = app.occurrence((e.target as HTMLElement).closest('tr')?.dataset.address);
    if (!dragged?.relation) return e.preventDefault();
    e.dataTransfer!.effectAllowed = 'copyMove';
    e.dataTransfer!.setData('text/plain', dragged.address); // Firefox needs data to start a drag
  });
  table.addEventListener('dragover', (e) => {
    const hit = dropTargetAt(e);
    setDropRow(hit?.row, hit?.mode);
    if (!hit) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = hit.copy ? 'copy' : 'move';
  });
  table.addEventListener('dragleave', (e) => {
    if (!table.contains(e.relatedTarget as Node | null)) setDropRow(undefined);
  });
  table.addEventListener('dragend', () => {
    setDropRow(undefined);
    dragged = undefined;
  });
  table.addEventListener('drop', (e) => {
    const hit = dropTargetAt(e);
    const relId = dragged?.relation?.id;
    if (!hit || !relId) return;
    e.preventDefault();
    const { parent, beforeId, copy } = hit;
    app.tryCommit(() => {
      const bom = activeBom(app.state);
      const rel = copy
        ? copyRelation(openDoc(app.state), bom, relId, parent.item.id, beforeId)
        : moveRelation(bom, relId, parent.item.id, beforeId);
      app.state.collapsed.delete(parent.address);
      app.state.selected = occurrencePath(bom.id, [...parent.path, rel.id]);
    });
  });

  table.addEventListener('keydown', (e) => {
    const i = visible.findIndex((o) => o.address === app.state.selected);
    const occ = visible[i];
    const isOpen = occ && occ.children.length > 0 && !app.state.collapsed.has(occ.address);
    switch (e.key) {
      case 'ArrowDown':
        select(visible[Math.min(i + 1, visible.length - 1)]?.address);
        break;
      case 'ArrowUp':
        select(visible[Math.max(i - 1, 0)]?.address);
        break;
      case 'ArrowRight':
        if (!occ?.children.length) return;
        if (isOpen) select(occ.children[0].address);
        else setCollapsed(occ.address, false);
        break;
      case 'ArrowLeft':
        if (!occ) return;
        if (isOpen) setCollapsed(occ.address, true);
        else if (occ.path.length) select(occurrencePath(activeBom(app.state).id, occ.path.slice(0, -1)));
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  function render(root: Occurrence): void {
    const { collapsed, selected } = app.state;
    visible = [];
    const rows: HTMLTableRowElement[] = [];
    // Excluded rows only exist while the configuration is applied; their children are excluded too.
    const hideExcluded = isHideExcluded();
    const walk = (occ: Occurrence, depth: number) => {
      if (hideExcluded && occ.status !== 'included') return;
      visible.push(occ);
      const isCollapsed = collapsed.has(occ.address);
      rows.push(renderRow(occ, depth, isCollapsed, occ.address === selected));
      if (!isCollapsed) occ.children.forEach((c) => walk(c, depth + 1));
    };
    walk(root, 0);
    tbody.replaceChildren(...rows);
    tbody.querySelector('tr.selected')?.scrollIntoView({ block: 'nearest' });
  }

  return { render };
}

function edit(host: HTMLElement, control: HTMLInputElement | HTMLSelectElement, width: string): void {
  control.classList.add('cell-edit');
  control.style.width = width;
  host.replaceChildren(control);
  control.focus();
}

/**
 * The nearest shown column after `col` in direction `step` that can be edited in place on this row;
 * without `col`, the first such column from the row's start (step 1) or end (step -1).
 */
function nextEditable(app: App, occ: Occurrence, col: string | undefined, step: 1 | -1): string | undefined {
  const keys = COLUMNS.map((c) => c.key);
  const start = col ? keys.indexOf(col) + step : step > 0 ? 0 : keys.length - 1;
  for (let i = start; i >= 0 && i < keys.length; i += step) {
    if (isColumnShown(keys[i]) && cellSaver(app, occ, keys[i])) return keys[i];
  }
}

/** Saves an edited cell's text, or undefined when the column cannot be edited in place on this row. Runs inside a commit. */
function cellSaver(app: App, occ: Occurrence, col: string): ((v: string) => void) | undefined {
  const doc = openDoc(app.state);
  const item = occ.item;
  const rel = occ.relation;
  const setRel = rel && ((patch: Parameters<typeof updateRelation>[2]) => updateRelation(activeBom(app.state), rel.id, patch));
  switch (col) {
    case 'name':
      return (v) => updateItem(doc, item.id, { name: v || item.name });
    case 'id':
      return (v) => renameItem(doc, item.id, v);
    case 'type':
      return () => {}; // saved by the type picker
    case 'qty':
      return setRel && ((v) => setRel({ qty: parseQty(v, rel.qty) }));
    case 'findNo':
      return setRel && ((v) => setRel({ findNo: v }));
    case 'variant':
      return (
        setRel &&
        ((v) => {
          setRel({ variantExpr: v });
          const [error] = validate(v, doc.families);
          if (error) app.toast(`Variant expression, col ${error.pos + 1}: ${error.message}`, true);
        })
      );
  }
}

function renderRow(occ: Occurrence, depth: number, isCollapsed: boolean, isSelected: boolean): HTMLTableRowElement {
  const rel = occ.relation;
  const twisty = occ.children.length
    ? h('span', { className: 'twisty', title: isCollapsed ? `Expand (${occ.children.length})` : 'Collapse' }, isCollapsed ? '▸' : '▾')
    : h('span', { className: 'twisty leaf' });
  const name = h('td', { className: 'name', dataset: { col: 'name' } }, twisty, h('span', {}, occ.item.name));
  name.style.paddingLeft = `${6 + depth * INDENT}px`;
  const eff = rel ? formatEff(rel.eff) : '';
  return h(
    'tr',
    {
      className: `st-${occ.status}${isSelected ? ' selected' : ''}`,
      title: [occ.item.description, occ.reason].filter(Boolean).join('\n'),
      draggable: !!rel,
      dataset: { address: occ.address },
    },
    name,
    h('td', { className: 'id', dataset: { col: 'id' } }, occ.item.id),
    h('td', { className: 'type', dataset: { col: 'type' } }, occ.item.type ?? ''),
    h('td', { className: 'num', dataset: { col: 'qty' } }, rel ? String(rel.qty) : ''),
    h('td', { className: 'num', dataset: { col: 'findNo' } }, rel?.findNo ?? ''),
    h('td', { className: 'expr', title: rel?.variantExpr ?? '', dataset: { col: 'variant' } }, h('span', {}, rel?.variantExpr ?? '')),
    h('td', { className: 'eff' }, eff),
    h('td', { className: 'filler' }),
  );
}
