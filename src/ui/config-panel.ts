import { h, openDoc, type App } from '../app';
import type { Occurrence } from '../resolve';
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
    return h('label', {}, f.name, select);
  });

  const date = h('input', { type: 'date', name: 'cfg-date', value: ctx.date ?? '' });
  date.addEventListener('change', () => app.commit(() => (ctx.date = date.value || undefined)));
  const unit = h('input', { type: 'number', name: 'cfg-unit', min: '1', step: '1', value: ctx.unit?.toString() ?? '' });
  unit.addEventListener('change', () => app.commit(() => (ctx.unit = unit.value ? Number(unit.value) : undefined)));

  container.replaceChildren(
    h('h2', {}, 'Configuration'),
    h('label', { className: 'check' }, enabled, 'Apply configuration'),
    h('fieldset', { disabled: !ctx.enabled }, ...options, h('label', {}, 'Date', date), h('label', {}, 'Unit', unit)),
    h('p', { className: 'muted' }, ctx.enabled ? `${included} of ${total} occurrences included` : `${total} occurrences`),
    h('h2', {}, 'Option families'),
    ...renderFamilies(app),
  );
}

function renderFamilies(app: App): HTMLElement[] {
  const doc = openDoc(app.state);
  const { ctx } = app.state;
  const rows = doc.families.map((f, i) => {
    const name = h('input', { name: `fam-${i}-name`, value: f.name, className: 'mono', title: 'Family name' });
    name.addEventListener('change', () => {
      const newName = name.value.trim();
      if (!newName || doc.families.some((o) => o !== f && o.name === newName)) {
        app.toast(`Family name '${newName}' is empty or already used`, true);
        name.value = f.name;
        return;
      }
      app.commit(() => {
        ctx.options[newName] = ctx.options[f.name];
        delete ctx.options[f.name];
        f.name = newName;
      });
    });
    const values = h('input', { name: `fam-${i}-values`, value: f.values.join(', '), className: 'mono', title: 'Comma-separated values' });
    values.addEventListener('change', () =>
      app.commit(() => {
        f.values = [...new Set(values.value.split(',').map((v) => v.trim()).filter(Boolean))];
        if (!f.values.includes(ctx.options[f.name] ?? '')) delete ctx.options[f.name];
      }),
    );
    const remove = h('button', { className: 'icon', title: `Remove ${f.name}` }, '✕');
    remove.addEventListener('click', () =>
      app.commit(() => {
        doc.families = doc.families.filter((o) => o !== f);
        delete ctx.options[f.name];
      }),
    );
    return h('div', { className: 'family-row' }, name, values, remove);
  });

  const add = h('button', {}, '+ Add family');
  add.addEventListener('click', () =>
    app.commit(() => {
      let n = doc.families.length + 1;
      while (doc.families.some((f) => f.name === `FAMILY${n}`)) n++;
      doc.families.push({ name: `FAMILY${n}`, values: [] });
    }),
  );
  return [
    ...rows,
    add,
    h('p', { className: 'muted' }, 'Renaming a family does not rewrite existing expressions; they will show as invalid.'),
  ];
}
