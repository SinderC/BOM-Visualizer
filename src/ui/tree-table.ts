import { activeBom, h, type App } from '../app';
import { formatEff } from '../effectivity';
import { moveRelation, occurrencePath } from '../model';
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

  // Drag a row onto another row to re-parent it there.
  let dragged: Occurrence | undefined;
  let dropRow: HTMLElement | undefined;
  const setDropRow = (row: HTMLElement | undefined) => {
    dropRow?.classList.remove('drop-target');
    dropRow = row;
    row?.classList.add('drop-target');
  };
  /** Drop target under the pointer, if the dragged row may be moved onto it. Other cycles are caught by moveRelation. */
  const dropTargetAt = (e: DragEvent) => {
    const row = (e.target as HTMLElement).closest('tr');
    const target = app.occurrence(row?.dataset.address);
    if (!row || !target || !dragged?.relation) return undefined;
    const inOwnSubtree = target.address === dragged.address || target.address.startsWith(`${dragged.address}/`);
    if (inOwnSubtree || target.item.id === dragged.relation.parentId) return undefined;
    return { row, target };
  };

  table.addEventListener('dragstart', (e) => {
    dragged = app.occurrence((e.target as HTMLElement).closest('tr')?.dataset.address);
    if (!dragged?.relation) return e.preventDefault();
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', dragged.address); // Firefox needs data to start a drag
  });
  table.addEventListener('dragover', (e) => {
    const hit = dropTargetAt(e);
    setDropRow(hit?.row);
    if (hit) e.preventDefault();
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
    if (!hit || !dragged?.relation) return;
    e.preventDefault();
    const relId = dragged.relation.id;
    const { target } = hit;
    try {
      app.commit(() => {
        moveRelation(activeBom(app.state), relId, target.item.id);
        app.state.collapsed.delete(target.address);
        app.state.selected = occurrencePath(activeBom(app.state).id, [...target.path, relId]);
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
