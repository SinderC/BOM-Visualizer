import { activeBom, h, type App } from '../app';
import { formatEff } from '../effectivity';
import { occurrencePath } from '../model';
import type { Occurrence } from '../resolve';

const INDENT = 18;
const COLUMNS = ['Name', 'Qty', 'Find no', 'Variant', 'Effectivity'];

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
      dataset: { address: occ.address },
    },
    name,
    h('td', { className: 'num' }, rel ? String(rel.qty) : ''),
    h('td', { className: 'num' }, rel?.findNo ?? ''),
    h('td', { className: 'expr', title: rel?.variantExpr ?? '' }, rel?.variantExpr ?? ''),
    h('td', { className: 'eff' }, eff),
  );
}
