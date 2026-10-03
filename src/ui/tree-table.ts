import { activeBom, h, type App } from '../app';
import { formatEff } from '../effectivity';
import { copyRelation, moveRelation, occurrencePath } from '../model';
import type { Occurrence } from '../resolve';

const INDENT = 18;
const COLUMNS = ['Name', 'Type', 'Qty', 'Find no', 'Variant', 'Effectivity'];

/** Indented tree-table (structure-manager style) with collapse, selection and keyboard navigation. */
export function createTreeTable(container: HTMLElement, app: App) {
  let visible: Occurrence[] = []; // rows in display order, for keyboard navigation
  const tbody = h('tbody');
  const table = h(
    'table',
    { className: 'tree-table', tabIndex: 0 },
    h('thead', {}, h('tr', {}, ...COLUMNS.map((c) => h('th', {}, c)))),
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
    try {
      app.commit(() => {
        const bom = activeBom(app.state);
        const rel = copy
          ? copyRelation(app.state.doc, bom, relId, parent.item.id, beforeId)
          : moveRelation(bom, relId, parent.item.id, beforeId);
        app.state.collapsed.delete(parent.address);
        app.state.selected = occurrencePath(bom.id, [...parent.path, rel.id]);
      });
    } catch (err) {
      app.toast((err as Error).message, true);
    }
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
    const walk = (occ: Occurrence, depth: number) => {
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

function renderRow(occ: Occurrence, depth: number, isCollapsed: boolean, isSelected: boolean): HTMLTableRowElement {
  const rel = occ.relation;
  const twisty = occ.children.length
    ? h('span', { className: 'twisty', title: isCollapsed ? `Expand (${occ.children.length})` : 'Collapse' }, isCollapsed ? '▸' : '▾')
    : h('span', { className: 'twisty leaf' });
  const name = h('td', { className: 'name' }, twisty, h('span', {}, occ.item.name), h('span', { className: 'id' }, occ.item.id));
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
    h('td', { className: 'type' }, occ.item.type ?? ''),
    h('td', { className: 'num' }, rel ? String(rel.qty) : ''),
    h('td', { className: 'num' }, rel?.findNo ?? ''),
    h('td', { className: 'expr', title: rel?.variantExpr ?? '' }, rel?.variantExpr ?? ''),
    h('td', { className: 'eff' }, eff),
  );
}
