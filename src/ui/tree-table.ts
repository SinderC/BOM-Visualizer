import { activeBom, openDoc, type App } from '../app';
import { formatEffEnd } from '../effectivity';
import { validate } from '../expr';
import { DEFAULT_UOM, lockedIdPrefix, moveRelations, occurrencePath, parentAddress, parseQty, renameItem, setItemType, setItemUom, updateItem, updateRelation } from '../model';
import { flatten, type Occurrence } from '../resolve';
import { h } from './dom';
import { typeSelect, uomSelect } from './editor';
import { attachExprCompletion } from './expr-complete';
import { COLUMNS, isColumnShown, isHideExcluded } from './view';

const INDENT = 18;
/** Name cell: left padding at depth 0 plus the twisty with its margin; see renderRow and the .twisty style. */
const NAME_INDENT = 6 + 20;
const CELL_PADDING = 20; // left + right, as in the .tree-table td style
const VARIANT_COL = COLUMNS.findIndex((c) => c.key === 'variant');
const VARIANT_MAX_CH = 48; // the .tree-table td.expr > span max-width
const OVERSCAN = 20;

/** What a tree-table shows and edits: its own selection, and whether in-place edit and drag and drop are on. */
export interface Pane {
  editable: boolean;
  /** The focused row. */
  selected(): string | undefined;
  /** The other selected rows; only panes that allow selecting several rows have it. */
  extra?(): string[];
  select(address: string | undefined, extra?: string[]): void;
}

/** The active BOM's pane: edits the document and uses the main selection. */
export const editPane = (app: App): Pane => ({
  editable: true,
  selected: () => app.state.selected,
  extra: () => app.state.extraSelected,
  select: (address, extra = []) => {
    app.state.selected = address;
    app.state.extraSelected = extra;
  },
});

/** Indented tree-table (structure-manager style) with collapse, selection and keyboard navigation. */
export function createTreeTable(container: HTMLElement, app: App, pane: Pane) {
  let visible: Occurrence[] = []; // rows in display order, for keyboard navigation
  let all: Occurrence[] = []; // all rows in display order, shown or not
  const tbody = h('tbody');
  const heads = COLUMNS.map((c) => h('th', {}, c.label));
  const thead = h('thead', {}, h('tr', {}, ...heads, h('th', { className: 'filler' })));
  const table = h('table', { className: 'tree-table', tabIndex: 0 }, thead, tbody);
  container.append(table);

  // Virtualized: only the rows in view, and OVERSCAN more on either side, are in the DOM; spacer rows stand in for the
  // rest. Large BOMs have tens of thousands of rows, which take seconds to build on every change.
  let depths: number[] = []; // indent level of each row of `visible`
  let indexOf = new Map<string, number>(); // address → index in `visible`
  let marks = { selected: new Set<string>(), unaligned: undefined as Set<string> | undefined };
  let rowHeight = 25; // measured on paint
  let painted = ''; // range of the rows in the DOM, so that a scroll within it repaints nothing
  container.addEventListener('scroll', () => paint());
  new ResizeObserver(() => paint()).observe(container);

  const select = (address: string | undefined, extra?: string[]) => app.view(() => pane.select(address, extra));
  const selection = () => [pane.selected(), ...(pane.extra?.() ?? [])].filter((a) => a !== undefined);
  const setCollapsed = (address: string, collapse: boolean) =>
    app.view(() => (collapse ? app.state.collapsed.add(address) : app.state.collapsed.delete(address)));

  table.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const address = target.closest('tr')?.dataset.address;
    // A click in an in-place edit field would re-render the row, which replaces the field and closes a picker's list.
    if (!address || target.closest('.cell-edit')) return;
    if (target.closest('.twisty')) setCollapsed(address, !app.state.collapsed.has(address));
    else if (pane.extra && (e.ctrlKey || e.metaKey)) toggle(address);
    else if (pane.extra && e.shiftKey) selectRange(address);
    else select(address);
  });
  // On macOS, Ctrl+click opens the context menu instead of clicking.
  table.addEventListener('contextmenu', (e) => {
    const address = (e.target as HTMLElement).closest('tr')?.dataset.address;
    if (!address || !pane.extra || !e.ctrlKey) return;
    e.preventDefault();
    toggle(address);
  });

  /** Ctrl/Cmd+click: adds the row to the selection as its focus, or takes it out. */
  function toggle(address: string): void {
    const rows = selection();
    if (!rows.includes(address)) return select(address, rows);
    const rest = rows.filter((a) => a !== address);
    const focus = pane.selected() === address ? rest.at(-1) : pane.selected();
    select(focus, rest.filter((a) => a !== focus));
  }

  /** Shift+click: selects the shown rows from the focused row to this one; the focus stays. */
  function selectRange(address: string): void {
    const focus = pane.selected();
    const [from, to] = [focus, address].map((a) => visible.findIndex((o) => o.address === a));
    if (from < 0) return select(address);
    const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1).map((o) => o.address);
    select(focus, range.filter((a) => a !== focus));
  }

  // Double-click a cell to edit its value in place. Enter or leaving the field saves, Escape cancels,
  // Tab / Shift+Tab saves and edits the next editable cell to the right / left, wrapping to the next / previous row.
  table.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    const td = target.closest('td');
    const address = td?.closest('tr')?.dataset.address;
    const col = td?.dataset.col;
    if (!pane.editable) return;
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

    if (col === 'type' || col === 'uom') {
      const picker =
        col === 'type'
          ? typeSelect(app, '', occ.item.type, (t) => setItemType(openDoc(app.state), occ.item.id, t))
          : uomSelect(app, '', occ.item.uom, (u) => setItemUom(openDoc(app.state), occ.item.id, u));
      picker.addEventListener('keydown', (ke) => keydown(ke));
      picker.addEventListener('change', done);
      // Restores the cell when nothing was picked. On macOS the open list is a window of its own, which blurs the
      // picker with the page losing focus; restoring then would close the list as it opens.
      picker.addEventListener('blur', () => document.hasFocus() && app.commit());
      return edit(host, picker, width);
    }

    // An item id's type prefix stays fixed; only the rest is edited.
    const prefix = col === 'id' ? lockedIdPrefix(openDoc(app.state), occ.item) : '';
    const field = h('input', { className: 'mono', value: (host.textContent ?? '').slice(prefix.length), spellcheck: false });
    if (col === 'variant') attachExprCompletion(field, () => openDoc(app.state).families); // before keydown: it takes Enter/Tab/Esc while open
    let cancelled = false;
    field.addEventListener('keydown', (ke) => keydown(ke, () => (cancelled = true)));
    field.addEventListener('blur', () => (cancelled ? app.commit() : app.tryCommit(() => save(prefix + field.value.trim()))));
    edit(host, field, width);
    if (prefix) host.prepend(h('span', { className: 'muted id-prefix' }, prefix));
    field.select();
  }

  // Drag a row onto another row to make it a child there, or onto a row's top/bottom edge to place it before/after
  // that row as a sibling. Holding Ctrl or Alt/Option when dropping copies the relation instead of moving it.
  // Dragging a selected row drags all selected rows that can move, in display order.
  type Mode = 'into' | 'before' | 'after';
  let dragged: Occurrence[] = [];
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
    if (!row || !target || !dragged.length) return undefined;
    const { top, height } = row.getBoundingClientRect();
    const y = (e.clientY - top) / height;
    const mode: Mode = !target.relation ? 'into' : y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
    const copy = isCopy(e);

    const blocked = (d: Occurrence) =>
      target.address.startsWith(`${d.address}/`) ||
      (target.address === d.address && (mode === 'into' || !copy)) ||
      (mode === 'into' && !copy && target.item.id === d.relation!.parentId);
    if (dragged.some(blocked)) return undefined;

    const parentPath = mode === 'into' ? target.path : target.path.slice(0, -1);
    const parent = app.occurrence(occurrencePath(activeBom(app.state).id, parentPath))!;
    const siblings = parent.children;
    const beforeId =
      mode === 'before' ? target.relation!.id : mode === 'after' ? siblings[siblings.indexOf(target) + 1]?.relation!.id : undefined;
    return { row, mode, copy, parent, beforeId };
  };

  table.addEventListener('dragstart', (e) => {
    if (!pane.editable) return e.preventDefault();
    const occ = app.occurrence((e.target as HTMLElement).closest('tr')?.dataset.address);
    if (!occ?.relation) return e.preventDefault();
    const rows = selection();
    dragged = rows.includes(occ.address) ? movable(rows) : [occ];
    e.dataTransfer!.effectAllowed = 'copyMove';
    e.dataTransfer!.setData('text/plain', occ.address); // Firefox needs data to start a drag
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
    dragged = [];
  });
  table.addEventListener('drop', (e) => {
    const hit = dropTargetAt(e);
    if (!hit) return;
    e.preventDefault();
    const { parent, beforeId, copy } = hit;
    const ids = dragged.map((d) => d.relation!.id);
    app.tryCommit(() => {
      const bom = activeBom(app.state);
      const rels = moveRelations(openDoc(app.state), bom, ids, parent.item.id, beforeId, copy);
      app.state.collapsed.delete(parent.address);
      const [first, ...rest] = rels.map((r) => occurrencePath(bom.id, [...parent.path, r.id]));
      pane.select(first, rest);
    });
  });

  /** The rows that move with a drag of these selected rows: those with a relation and no selected ancestor, one per relation. */
  function movable(addresses: string[]): Occurrence[] {
    const selected = new Set(addresses);
    const ids = new Set<string>();
    const hasSelectedAncestor = (address: string) => {
      for (let a = parentAddress(address); a !== address; address = a, a = parentAddress(a)) if (selected.has(a)) return true;
      return false;
    };
    return all.filter((o) => {
      const rel = o.relation;
      if (!rel || ids.has(rel.id) || !selected.has(o.address) || hasSelectedAncestor(o.address)) return false;
      ids.add(rel.id);
      return true;
    });
  }

  table.addEventListener('keydown', (e) => {
    const i = visible.findIndex((o) => o.address === pane.selected());
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
        else if (occ.path.length) select(parentAddress(occ.address));
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  /** Rows listed in `unaligned` are marked as such. */
  function render(root: Occurrence, unaligned?: Set<string>): void {
    const { collapsed } = app.state;
    all = flatten(root);
    visible = [];
    depths = [];
    // Excluded rows only exist while the configuration is applied; their children are excluded too.
    const hideExcluded = isHideExcluded();
    const walk = (occ: Occurrence, depth: number) => {
      if (hideExcluded && occ.status !== 'included') return;
      visible.push(occ);
      depths.push(depth);
      if (!collapsed.has(occ.address)) occ.children.forEach((c) => walk(c, depth + 1));
    };
    walk(root, 0);
    indexOf = new Map(visible.map((o, i) => [o.address, i]));
    marks = { selected: new Set(selection()), unaligned };
    fitColumns();
    painted = '';
    paint(); // first, so the spacers give the table its full height to scroll in
    scrollToFocused();
    paint();
  }

  /** Fixes each column at the width of its widest shown cell, so that columns do not change width while scrolling. */
  function fitColumns(): void {
    const probe = h('span', { className: 'mono' }, '0'.repeat(100));
    probe.style.cssText = 'position: absolute; visibility: hidden';
    container.append(probe);
    const ch = probe.getBoundingClientRect().width / 100; // cells use a monospace font
    probe.remove();
    const widest = heads.map(() => 0);
    visible.forEach((occ, i) => {
      cellTexts(occ).forEach((text, col) => {
        const indent = col ? 0 : NAME_INDENT + depths[i] * INDENT;
        widest[col] = Math.max(widest[col], indent + Math.min(text.length, col === VARIANT_COL ? VARIANT_MAX_CH : Infinity) * ch);
      });
    });
    // + cell padding, and a pixel for rounding
    heads.forEach((th, col) => (th.style.width = `${Math.ceil(widest[col] + CELL_PADDING + 1)}px`));
  }

  /** Viewport top of the first row. */
  const rowsTop = () => table.getBoundingClientRect().top + thead.offsetHeight;

  /** Puts the rows in view (and OVERSCAN more on either side) in the DOM, unless they already are. */
  function paint(): void {
    const above = container.getBoundingClientRect().top - rowsTop(); // scrolled past, in px
    const first = Math.max(0, Math.floor(above / rowHeight) - OVERSCAN);
    const last = Math.min(visible.length, Math.ceil((above + container.clientHeight) / rowHeight) + OVERSCAN);
    if (`${first}:${last}` === painted) return;
    painted = `${first}:${last}`;
    const rows: HTMLTableRowElement[] = [];
    for (let i = first; i < last; i++) rows.push(paintRow(i));
    tbody.replaceChildren(spacer(first * rowHeight), ...rows, spacer((visible.length - last) * rowHeight));
    // Measured rather than set in CSS, so that it follows the font; 0 while hidden.
    const measured = rows[0]?.getBoundingClientRect().height;
    if (measured && Math.abs(measured - rowHeight) > 0.01) {
      rowHeight = measured;
      painted = '';
      paint();
    }
  }

  function paintRow(i: number): HTMLTableRowElement {
    const occ = visible[i];
    const row = renderRow(occ, depths[i], app.state.collapsed.has(occ.address), marks.selected.has(occ.address));
    row.classList.toggle('focused', occ.address === pane.selected());
    row.classList.toggle('band', i % 2 === 1);
    row.draggable &&= pane.editable;
    row.classList.toggle('unaligned', !!marks.unaligned?.has(occ.address));
    return row;
  }

  const spacer = (height: number) => {
    const td = h('td', { colSpan: heads.length + 1 });
    td.style.height = `${height}px`;
    return h('tr', { className: 'spacer' }, td);
  };

  /** Scrolls the focused row into view, below the sticky header, if it is not. */
  function scrollToFocused(): void {
    const i = indexOf.get(pane.selected() ?? '');
    if (i === undefined) return;
    const top = rowsTop() + i * rowHeight - container.getBoundingClientRect().top; // relative to the view
    const head = thead.offsetHeight;
    if (top < head) container.scrollTop += top - head;
    else if (top + rowHeight > container.clientHeight) container.scrollTop += top + rowHeight - container.clientHeight;
  }

  /** Viewport y of the centre of the address's row; a collapsed or hidden row gives its nearest shown ancestor's. */
  function rowY(address: string): { y: number; ancestor: boolean } | undefined {
    for (let a = address; ; a = parentAddress(a)) {
      const i = indexOf.get(a);
      if (i !== undefined) return { y: rowsTop() + (i + 0.5) * rowHeight, ancestor: a !== address };
      if (a === parentAddress(a)) return undefined;
    }
  }

  return { table, render, rowY };
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
    case 'uom':
      return () => {}; // saved by the picker
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

/** The text of each column's cell, in COLUMNS order. */
function cellTexts(occ: Occurrence): string[] {
  const rel = occ.relation;
  return [
    occ.item.name,
    occ.item.id,
    occ.item.type ?? '',
    rel ? String(rel.qty) : '',
    occ.item.uom ?? DEFAULT_UOM,
    rel?.findNo ?? '',
    rel?.variantExpr ?? '',
    rel ? formatEffEnd(rel.eff, 'from') : '',
    rel ? formatEffEnd(rel.eff, 'to') : '',
  ];
}

function renderRow(occ: Occurrence, depth: number, isCollapsed: boolean, isSelected: boolean): HTMLTableRowElement {
  const rel = occ.relation;
  const [label, id, type, qty, uom, findNo, variant, effFrom, effTo] = cellTexts(occ);
  const twisty = occ.children.length
    ? h('span', { className: 'twisty', title: isCollapsed ? `Expand (${occ.children.length})` : 'Collapse' }, h('span', { className: isCollapsed ? 'caret right' : 'caret' }))
    : h('span', { className: 'twisty leaf' });
  const name = h('td', { className: 'name', dataset: { col: 'name' } }, twisty, h('span', {}, label));
  name.style.paddingLeft = `${6 + depth * INDENT}px`;
  return h(
    'tr',
    {
      className: `st-${occ.status}${isSelected ? ' selected' : ''}`,
      title: [occ.item.description, occ.reason].filter(Boolean).join('\n'),
      draggable: !!rel,
      dataset: { address: occ.address },
    },
    name,
    h('td', { className: 'id', dataset: { col: 'id' } }, id),
    h('td', { className: 'type', dataset: { col: 'type' } }, type),
    h('td', { className: 'num', dataset: { col: 'qty' } }, qty),
    h('td', { className: 'uom', dataset: { col: 'uom' } }, uom),
    h('td', { className: 'num', dataset: { col: 'findNo' } }, findNo),
    h('td', { className: 'expr', title: variant, dataset: { col: 'variant' } }, h('span', {}, variant)),
    h('td', { className: 'eff' }, effFrom),
    h('td', { className: 'eff' }, effTo),
    h('td', { className: 'filler' }),
  );
}
