import { openDoc, type App } from '../app';
import { addFamily, removeFamily, renameFamily, setFamilyValues } from '../model';
import type { Occurrence } from '../resolve';
import { button, field, h, input } from './dom';
import { setApplyConfig } from './view';

function count(o: Occurrence): { total: number; included: number } {
  return o.children.map(count).reduce(
    (acc, c) => ({ total: acc.total + c.total, included: acc.included + c.included }),
    { total: 1, included: o.status === 'included' ? 1 : 0 },
  );
}

export function renderConfigPanel(container: HTMLElement, app: App, root: Occurrence): void {
  const doc = openDoc(app.state);
  const { ctx } = app.state;
  const { total, included } = count(root);

  const enabled = h('input', { type: 'checkbox', name: 'cfg-enabled', checked: ctx.enabled });
  enabled.addEventListener('change', () => app.commit(() => setApplyConfig((ctx.enabled = enabled.checked))));

  const options = doc.families.map((f) => {
    const select = h(
      'select',
      { name: `cfg-opt-${f.name}` },
      h('option', { value: '' }, '— unset —'),
      ...f.values.map((v) => h('option', { value: v, selected: ctx.options[f.name] === v }, v)),
    );
    select.addEventListener('change', () => app.commit(() => (ctx.options[f.name] = select.value || undefined)));
    return field(f.name, select);
  });

  const date = input('cfg-date', ctx.date, (v) => app.commit(() => (ctx.date = v || undefined)), { type: 'date' });
  const unit = input('cfg-unit', ctx.unit, (v) => app.commit(() => (ctx.unit = v ? Number(v) : undefined)), {
    type: 'number',
    min: '1',
    step: '1',
  });

  // Two sections, each shown or hidden from the View menu.
  container.replaceChildren(
    h(
      'section',
      { className: 'config-section' },
      h('h2', {}, 'Configuration'),
      h('label', { className: 'check' }, enabled, 'Apply configuration'),
      h('fieldset', { disabled: !ctx.enabled }, ...options, field('Date', date), field('Unit', unit)),
      h('p', { className: 'muted' }, ctx.enabled ? `${included} of ${total} occurrences included` : `${total} occurrences`),
    ),
    h('section', { className: 'families-section' }, h('h2', {}, 'Option families'), ...renderFamilies(app)),
  );
}

function renderFamilies(app: App): HTMLElement[] {
  const doc = openDoc(app.state);
  const { ctx } = app.state;
  const rows = doc.families.map((f, i) => {
    const name = input(
      `fam-${i}-name`,
      f.name,
      (v) =>
        app.tryCommit(() => {
          const oldName = f.name;
          renameFamily(doc, oldName, v);
          ctx.options[v] = ctx.options[oldName];
          if (v !== oldName) delete ctx.options[oldName];
        }),
      { className: 'mono', title: 'Family name' },
    );
    const values = input(
      `fam-${i}-values`,
      f.values.join(', '),
      (v) =>
        app.commit(() => {
          setFamilyValues(doc, f.name, v.split(','));
          if (!f.values.includes(ctx.options[f.name] ?? '')) delete ctx.options[f.name];
        }),
      { className: 'mono', title: 'Comma-separated values' },
    );
    const remove = () =>
      app.commit(() => {
        removeFamily(doc, f.name);
        delete ctx.options[f.name];
      });
    return h('div', { className: 'family-row' }, name, values, button({ className: 'icon', title: `Remove ${f.name}` }, remove, '✕'));
  });

  const add = button({}, () => app.commit(() => addFamily(doc)), '+ Add family');
  return [
    ...rows,
    add,
    h('p', { className: 'muted' }, 'Renaming a family does not rewrite existing expressions; they will show as invalid.'),
  ];
}
