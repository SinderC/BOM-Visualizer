import type { ConfigContext } from './resolve';

/**
 * Working copy kept in localStorage so the document and the configuration survive reloads. One per origin; the last
 * tab to write wins. The XML is stored gzipped as base64, about 7 times smaller, as localStorage holds only a few MB.
 */
const AUTOSAVE_KEY = 'bom-visualizer.autosave';

export interface Autosaved {
  fileName: string;
  xml: string; // empty = no document open (closed)
  dirty?: boolean; // unsaved to file; absent in autosaves written before this was tracked
  config?: Pick<ConfigContext, 'options' | 'date' | 'unit'>; // absent in autosaves written before this was kept
}

/** As stored: `xmlGzip` in place of `xml`, which only autosaves written before compression have. */
type Stored = Omit<Autosaved, 'xml'> & { xml?: string; xmlGzip?: string };

async function gzip(text: string): Promise<string> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  // In chunks: spreading millions of arguments into fromCharCode overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function gunzip(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Response(new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))).text();
}

export async function loadAutosave(): Promise<Autosaved | undefined> {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return undefined;
    const { xmlGzip, xml = '', ...rest } = JSON.parse(raw) as Stored;
    return { ...rest, xml: xmlGzip ? await gunzip(xmlGzip) : xml };
  } catch {
    return undefined; // storage unavailable or corrupt: start from the sample
  }
}

/** Number of the latest write; an older one still compressing is dropped so it cannot overwrite a newer one. */
let latestWrite = 0;

/**
 * Returns the error message if the write failed (storage unavailable or quota exceeded). The older autosave is then
 * removed, so that a reload does not bring back an older document.
 */
export async function writeAutosave(data: Autosaved): Promise<string | undefined> {
  const write = ++latestWrite;
  try {
    const { xml, ...rest } = data;
    const stored: Stored = xml ? { ...rest, xmlGzip: await gzip(xml) } : { ...rest, xml };
    if (write !== latestWrite) return undefined;
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(stored));
    return undefined;
  } catch (e) {
    if (write !== latestWrite) return undefined; // a newer write is under way and reports for itself
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      // storage unavailable: nothing to remove
    }
    return (e as Error).message;
  }
}
