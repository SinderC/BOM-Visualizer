import { setPanelWidth, type Panel } from './view';

const MIN_WIDTH = 180;
const MIN_TREE_WIDTH = 240; // what dragging a panel wider must leave for the tree

/** Lets the side panels' inner borders be dragged to resize them; double-click restores the default width. */
export function initResizers(): void {
  for (const handle of document.querySelectorAll<HTMLElement>('.resizer')) {
    const panel = handle.dataset.panel as Panel;
    const other = document.getElementById(panel === 'config' ? 'editor' : 'config-panel')!;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // no text selection while dragging
      handle.classList.add('dragging');
      let width: number | undefined;
      const move = (e: PointerEvent) => {
        const main = handle.parentElement!.getBoundingClientRect();
        const max = main.width - other.offsetWidth - MIN_TREE_WIDTH;
        const wanted = panel === 'config' ? e.clientX - main.left : main.right - e.clientX;
        width = Math.max(MIN_WIDTH, Math.min(max, wanted));
        document.documentElement.style.setProperty(`--${panel}-size`, `${width}px`);
      };
      // Stored once at the end, not on every move.
      const end = () => {
        removeEventListener('pointermove', move);
        handle.classList.remove('dragging');
        if (width) setPanelWidth(panel, width);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', end, { once: true });
    });
    handle.addEventListener('dblclick', () => setPanelWidth(panel, undefined));
  }
}
