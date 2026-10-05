import { openDoc, type App } from '../app';
import { flatten, type Occurrence } from '../resolve';
import { button, dateField, field, h, input } from './dom';
import { setApplyConfig } from './view';

export function renderConfigPanel(container: HTMLElement, app: App, root: Occurrence): void {
  const doc = openDoc(app.state);
  const { ctx } = app.state;
  const all = flatten(root);
  const total = all.length;
  const included = all.filter((o) => o.status === 'included').length;

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

  const hasSelection = Object.values(ctx.options).some(Boolean) || !!ctx.date || ctx.unit !== undefined;
  const clear = button(
    { className: 'clear-config', disabled: !ctx.enabled || !hasSelection },
    () =>
      app.commit(() => {
        ctx.options = {};
        ctx.date = ctx.unit = undefined;
      }),
    'Clear all selections',
  );

  const date = dateField('cfg-date', ctx.date, (v) => app.commit(() => (ctx.date = v || undefined)));
  const unit = input('cfg-unit', ctx.unit, (v) => app.commit(() => (ctx.unit = v ? Number(v) : undefined)), {
    type: 'number',
    min: '1',
    step: '1',
  });

  container.replaceChildren(
    h('h2', {}, 'Configuration'),
    h('label', { className: 'check' }, enabled, 'Apply configuration'),
    clear,
    h('fieldset', { disabled: !ctx.enabled }, ...options, field('Date', date), field('Unit', unit)),
    h('p', { className: 'muted' }, ctx.enabled ? `${included} of ${total} occurrences included` : `${total} occurrences`),
  );
}
