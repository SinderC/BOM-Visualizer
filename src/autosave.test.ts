import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAutosave, writeAutosave, type Autosaved } from './autosave';

const KEY = 'bom-visualizer.autosave';
const data: Autosaved = { fileName: 'car.xml', xml: '<bomDocument/>'.repeat(1000), dirty: true, config: { options: { ENGINE: 'V8' } } };

describe('autosave', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('round-trips, storing the XML gzipped', async () => {
    expect(await writeAutosave(data)).toBeUndefined();
    const raw = localStorage.getItem(KEY)!;
    expect(raw).not.toContain('<bomDocument');
    expect(raw.length).toBeLessThan(data.xml.length / 10);
    expect(await loadAutosave()).toEqual(data);
  });

  it('keeps a closed document as empty XML', async () => {
    await writeAutosave({ fileName: '', xml: '' });
    expect(await loadAutosave()).toEqual({ fileName: '', xml: '' });
  });

  it('reads autosaves written before compression', async () => {
    localStorage.setItem(KEY, JSON.stringify(data));
    expect(await loadAutosave()).toEqual(data);
  });

  it('lets the latest of overlapping writes win', async () => {
    const first = writeAutosave(data);
    const second = writeAutosave({ ...data, fileName: 'newer.xml' });
    await Promise.all([first, second]);
    expect((await loadAutosave())!.fileName).toBe('newer.xml');
  });

  it('removes the older autosave when a write fails', async () => {
    await writeAutosave(data);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    expect(await writeAutosave({ ...data, fileName: 'big.xml' })).toBe('Quota exceeded');
    expect(await loadAutosave()).toBeUndefined();
  });
});
