import type { WebFont } from './carving';

export type FontCategory = 'sans' | 'serif' | 'display' | 'handwriting' | 'mono';
export interface CatalogFamily {
  family: string;
  category: FontCategory;
  weights: number[];
}

let catalog: Promise<CatalogFamily[]> | undefined;
export function loadFontCatalog(): Promise<CatalogFamily[]> {
  return (catalog ??= import('./googleFonts.json').then(({ default: rows }) =>
    rows.map(([family, category, weights]) => ({ family, category, weights }) as CatalogFamily)
  ));
}

export function defaultWeight(weights: number[]): number {
  return weights.reduce(
    (best, w) => (Math.abs(w - 700) < Math.abs(best - 700) || (Math.abs(w - 700) === Math.abs(best - 700) && w > best) ? w : best),
    weights[0] ?? 700
  );
}

const alias = (font: WebFont) => `camNC ${font.family} ${font.weight}`;
export const webFontCss = (font: WebFont): string => JSON.stringify(alias(font));
const familyParam = (family: string) => encodeURIComponent(family).replace(/%20/g, '+');
export const previewStylesheetUrl = (family: string): string =>
  `https://fonts.googleapis.com/css2?family=${familyParam(family)}&text=${encodeURIComponent(family)}&display=swap`;

interface FontRecord extends WebFont {
  faces: { unicodeRange?: string; data: ArrayBuffer }[];
  usedAt: number;
}

let database: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
  if (database) return database;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('camnc-fonts', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('faces');
    req.onsuccess = () => {
      const db = req.result;
      const invalidate = () => {
        if (database === opening) database = undefined;
      };
      db.onclose = invalidate;
      db.onversionchange = () => {
        db.close();
        invalidate();
      };
      resolve(db);
    };
    req.onerror = () => {
      if (database === opening) database = undefined;
      reject(req.error);
    };
  });
  database = opening;
  return opening;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const keyOf = (font: WebFont) => `${font.family}:${font.weight}`;
async function storeFont(record: FontRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('faces', 'readwrite');
    tx.objectStore('faces').put(record, keyOf(record));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function fetchFont(font: WebFont, fetcher: typeof fetch): Promise<FontRecord> {
  const css = await fetcher(`https://fonts.googleapis.com/css2?family=${familyParam(font.family)}:wght@${font.weight}&display=swap`);
  if (!css.ok) throw new Error('Font stylesheet unavailable');
  const blocks = [...(await css.text()).matchAll(/(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{([^}]+)\}/g)];
  const hasSubsets = blocks.some(block => block[1]);
  const selected = blocks.filter(block => !hasSubsets || block[1] === 'latin' || block[1] === 'latin-ext');
  if (!selected.length) throw new Error('No Latin font faces');
  const faces = await Promise.all(
    selected.map(async block => {
      const url = /src:\s*url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/.exec(block[2])?.[1];
      if (!url) throw new Error('Missing font source');
      const response = await fetcher(url);
      if (!response.ok) throw new Error('Font file unavailable');
      const unicodeRange = /unicode-range:\s*([^;]+)/.exec(block[2])?.[1].trim();
      return { data: await response.arrayBuffer(), ...(unicodeRange && { unicodeRange }) };
    })
  );
  return { ...font, faces, usedAt: Date.now() };
}

const loaded = new Map<string, Promise<FontRecord>>();

/** Clear promises so tests can exercise a new session using the persistent cache. */
export function resetWebFontsForTests(): void {
  loaded.clear();
}

export async function ensureWebFont(font: WebFont, opts: { fetch?: typeof fetch } = {}): Promise<void> {
  const key = keyOf(font);
  let pending = loaded.get(key);
  if (!pending) {
    pending = (async () => {
      const db = await openDb().catch(() => undefined);
      let record = db
        ? await request<FontRecord | undefined>(db.transaction('faces').objectStore('faces').get(key)).catch(() => undefined)
        : undefined;
      if (!record) {
        record = await fetchFont(font, opts.fetch ?? globalThis.fetch);
      }
      const fonts = typeof document !== 'undefined' ? document.fonts : (self as unknown as { fonts: FontFaceSet }).fonts;
      const faces = await Promise.all(
        record.faces.map(async ({ data, unicodeRange }) => {
          const face = new FontFace(alias(font), data, { weight: String(font.weight), ...(unicodeRange && { unicodeRange }) });
          await face.load();
          return face;
        })
      );
      for (const face of faces) fonts.add(face);
      // Kept, or marked as just used, for the next session and offline use.
      await storeFont({ ...record, usedAt: Date.now() }).catch(() => {});
      return record;
    })().catch(() => {
      loaded.delete(key);
      throw new Error(`Could not load the font "${font.family}". Check the connection, or pick a built-in font.`);
    });
    loaded.set(key, pending);
  }
  await pending;
}

export async function fontsOnDevice(): Promise<WebFont[]> {
  const db = await openDb();
  const records = await request<FontRecord[]>(db.transaction('faces').objectStore('faces').getAll());
  return records.sort((a, b) => b.usedAt - a.usedAt).map(({ family, weight }) => ({ family, weight }));
}
