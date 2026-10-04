import { activeBom, openDoc, type App } from '../app';
import { addAlignment, findBom, parentAddress, removeAlignment, type Alignment, type Bom } from '../model';
import { flatten, type Occurrence } from '../resolve';
import { button, h } from './dom';
import { createTreeTable } from './tree-table';

const SVG = 'http://www.w3.org/2000/svg';

/** An alignment between the active (left) BOM and the aligned (right) BOM, whichever end is its source. */
interface Link {
  alignment: Alignment;
  left: string;
  right: string;
}

/** The right-hand BOM; only call while aligning. */
const alignedBom = (app: App): Bom => findBom(openDoc(app.state), app.state.align!.bomId)!;

/** Alignments between the two shown BOMs whose ends both resolve; dangling ones are not shown. */
function links(app: App): Link[] {
  const leftId = activeBom(app.state).id;
  return openDoc(app.state).alignments.flatMap((alignment) => {
    const { source, target } = alignment;
    const [left, right] = source.startsWith(`${leftId}:`) ? [source, target] : [target, source];
    const shown = left.startsWith(`${leftId}:`) && right.startsWith(`${app.state.align!.bomId}:`);
    return shown && app.occurrence(left) && app.occurrence(right) ? [{ alignment, left, right }] : [];
  });
}

/** Occurrences below the root that no shown alignment links to. */
function unaligned(root: Occurrence, linked: Set<string>): Set<string> {
  return new Set(flatten(root).filter((o) => o.relation && !linked.has(o.address)).map((o) => o.address));
}

/** Read-only side-by-side view of the active BOM (left) and the aligned BOM (right), with link lines between them. */
export function createAlignmentView(container: HTMLElement, app: App) {
  const leftPane = h('div', { className: 'align-pane' });
  const rightPane = h('div', { className: 'align-pane' });
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('align-links');
  container.append(h('div', { className: 'align-view' }, leftPane, svg, rightPane));

  const left = createTreeTable(leftPane, app, {
    editable: false,
    selected: () => app.state.selected,
    select: (a) => (app.state.selected = a),
  });
  const right = createTreeTable(rightPane, app, {
    editable: false,
    selected: () => app.state.align?.selected,
    select: (a) => app.state.align && (app.state.align.selected = a),
  });
  let shown: Link[] = [];

  /** Vertical centre of the address's row relative to the gutter; a collapsed or hidden row is drawn at its nearest shown ancestor. */
  const rowY = (paneEl: HTMLElement, address: string, top: number) => {
    for (let a = address; ; a = parentAddress(a)) {
      const row = paneEl.querySelector(`tr[data-address="${CSS.escape(a)}"]`);
      if (row) {
        const r = row.getBoundingClientRect();
        return { y: r.top + r.height / 2 - top, ancestor: a !== address };
      }
      if (a === parentAddress(a)) return undefined;
    }
  };

  function drawLinks(): void {
    const { top, width } = svg.getBoundingClientRect();
    const paths = shown.flatMap(({ left: l, right: r }) => {
      const a = rowY(leftPane, l, top);
      const b = rowY(rightPane, r, top);
      if (!a || !b) return [];
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', `M0 ${a.y} C${width / 2} ${a.y} ${width / 2} ${b.y} ${width} ${b.y}`);
      path.classList.toggle('active', l === app.state.selected || r === app.state.align?.selected);
      path.classList.toggle('ancestor', a.ancestor || b.ancestor);
      return [path];
    });
    svg.replaceChildren(...paths);
  }

  let drawQueued = false;
  const queueDraw = () => {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      drawLinks();
    });
  };
  leftPane.addEventListener('scroll', queueDraw);
  rightPane.addEventListener('scroll', queueDraw);
  new ResizeObserver(queueDraw).observe(svg);

  function render(leftRoot: Occurrence, rightRoot: Occurrence): void {
    shown = links(app);
    left.render(leftRoot, unaligned(leftRoot, new Set(shown.map((l) => l.left))));
    right.render(rightRoot, unaligned(rightRoot, new Set(shown.map((l) => l.right))));
    drawLinks();
  }

  return { render };
}

/** Side panel in the alignment view: align the two selected rows, list and remove their alignments, coverage counts. */
export function renderAlignPanel(container: HTMLElement, app: App, leftRoot: Occurrence, rightRoot: Occurrence): void {
  const doc = openDoc(app.state);
  const leftBom = activeBom(app.state);
  const rightBom = alignedBom(app);
  const shown = links(app);
  const leftOcc = app.occurrence(app.state.selected);
  const rightOcc = app.occurrence(app.state.align?.selected);

  const describe = (occ: Occurrence) => [h('div', {}, occ.item.name), h('div', { className: 'mono muted' }, occ.address)];
  const selection = (bom: Bom, occ: Occurrence | undefined) =>
    h('div', { className: 'align-pick' }, h('h3', {}, bom.name || bom.id), ...(occ ? describe(occ) : [h('p', { className: 'muted' }, 'Select a row.')]));

  const isLinked = shown.some((l) => l.left === leftOcc?.address && l.right === rightOcc?.address);
  const align = button(
    { title: 'Align the two selected occurrences' },
    () => app.tryCommit(() => addAlignment(doc, leftOcc!.address, rightOcc!.address)),
    'Align',
  );
  align.disabled = !leftOcc?.relation || !rightOcc?.relation || isLinked;

  // Alignments of the selected rows, each shown by its far end.
  const selected = [leftOcc?.address, rightOcc?.address].filter((a) => a !== undefined);
  const listed = shown.filter((l) => selected.includes(l.left) || selected.includes(l.right));
  const list = listed.map(({ alignment, left, right }) => {
    const other = app.occurrence(selected.includes(left) ? right : left)!;
    const remove = button({ className: 'icon danger', title: `Remove alignment ${alignment.id}` }, () => app.commit(() => removeAlignment(doc, alignment.id)), '✕');
    return h('div', { className: 'align-row' }, h('div', {}, ...describe(other)), remove);
  });

  const coverage = (bom: Bom, root: Occurrence, linked: Set<string>) => {
    const occs = flatten(root).filter((o) => o.relation);
    const n = occs.filter((o) => linked.has(o.address)).length;
    return h('p', { className: 'muted' }, `${bom.name || bom.id}: ${n} of ${occs.length} occurrences aligned`);
  };

  container.replaceChildren(
    h('h2', {}, 'Alignment'),
    h('div', { className: 'row' }, selection(leftBom, leftOcc), selection(rightBom, rightOcc)),
    align,
    h('h3', {}, 'Aligned with selection'),
    ...(list.length ? list : [h('p', { className: 'muted' }, selected.length ? 'None.' : 'Select a row to see its alignments.')]),
    h('h3', {}, 'Coverage'),
    coverage(leftBom, leftRoot, new Set(shown.map((l) => l.left))),
    coverage(rightBom, rightRoot, new Set(shown.map((l) => l.right))),
    h('p', { className: 'muted hint' }, 'Unaligned rows are marked at the left edge. Alignments are removed when an end is removed or moved.'),
  );
}
