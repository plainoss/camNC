import { afterEach, describe, expect, it, vi } from 'vitest';
import { fontLabel, isWebFont } from './carving';
import lobsterUrl from './testdata/lobster-oil.ttf?url';
import {
  defaultWeight,
  ensureWebFont,
  fontsOnDevice,
  loadFontCatalog,
  previewStylesheetUrl,
  resetWebFontsForTests,
  webFontCss,
} from './webFonts';

afterEach(() => {
  resetWebFontsForTests();
  vi.restoreAllMocks();
});

const face = (subset: string, range: string) => `/* ${subset} */
@font-face { font-family: 'Lobster'; src: url(https://fonts.gstatic.com/${subset}.woff2) format('woff2'); unicode-range: ${range}; }`;

it('loads just Latin faces, registers a private alias, and loads again offline from IndexedDB', async () => {
  const data = await (await fetch(lobsterUrl)).arrayBuffer();
  const css = [face('cyrillic', 'U+0400-04FF'), face('latin-ext', 'U+0100-024F'), face('latin', 'U+0000-00FF')].join('\n');
  const fetcher = vi.fn<typeof fetch>(async input => new Response(String(input).includes('googleapis') ? css : data));
  const font = { family: 'Lobster', weight: 400 };
  await Promise.all([ensureWebFont(font, { fetch: fetcher }), ensureWebFont(font, { fetch: fetcher })]);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://fonts.googleapis.com/css2?family=Lobster:wght@400&display=swap',
    'https://fonts.gstatic.com/latin-ext.woff2',
    'https://fonts.gstatic.com/latin.woff2',
  ]);
  expect(document.fonts.check(`400 20px ${webFontCss(font)}`, 'O')).toBe(true);
  expect(await fontsOnDevice()).toContainEqual(font);
  resetWebFontsForTests();
  document.fonts.forEach(face => {
    if (face.family.includes('camNC Lobster')) document.fonts.delete(face);
  });
  const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
  await ensureWebFont(font, { fetch: offline });
  expect(offline).not.toHaveBeenCalled();
  expect(document.fonts.check(`400 20px ${webFontCss(font)}`, 'O')).toBe(true);
});

it('encodes family names, accepts CSS without subset comments, and sorts by recent use', async () => {
  const data = await (await fetch(lobsterUrl)).arrayBuffer();
  const fetcher = vi.fn<typeof fetch>(
    async input =>
      new Response(String(input).includes('googleapis') ? "@font-face { src: url('https://fonts.gstatic.com/font.ttf'); }" : data)
  );
  const first = { family: 'Font With & Spaces', weight: 700 };
  const second = { family: 'Other Font', weight: 400 };
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 100);
  await ensureWebFont(first, { fetch: fetcher });
  expect(fetcher.mock.calls[0][0]).toBe('https://fonts.googleapis.com/css2?family=Font+With+%26+Spaces:wght@700&display=swap');
  clock.mockReturnValue(now + 200);
  await ensureWebFont(second, { fetch: fetcher });
  clock.mockReturnValue(now + 300);
  await ensureWebFont(first, { fetch: fetcher });
  expect((await fontsOnDevice()).slice(0, 2)).toEqual([first, second]);
  expect(previewStylesheetUrl(first.family)).toBe(
    'https://fonts.googleapis.com/css2?family=Font+With+%26+Spaces&text=Font%20With%20%26%20Spaces&display=swap'
  );
});

it('explains download failures and allows retrying them', async () => {
  const font = { family: 'Not Cached', weight: 400 };
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
  for (let i = 0; i < 2; i++)
    await expect(ensureWebFont(font, { fetch: fetcher })).rejects.toThrow(
      'Could not load the font "Not Cached". Check the connection, or pick a built-in font.'
    );
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects unsuccessful HTTP responses instead of caching them', async () => {
  await expect(ensureWebFont({ family: 'Missing', weight: 400 }, { fetch: async () => new Response('', { status: 404 }) })).rejects.toThrow(
    'Could not load the font "Missing"'
  );
  expect(await fontsOnDevice()).not.toContainEqual({ family: 'Missing', weight: 400 });
});

describe('font choices', () => {
  it.each([
    [[400], 400],
    [[400, 600, 800], 800],
    [[100, 400, 700, 900], 700],
    [[800, 600], 800],
    [[900, 400], 900],
  ])('picks the weight closest to bold from %j', (weights, expected) => {
    expect(defaultWeight(weights as number[])).toBe(expected);
  });
  it('keeps built-in labels and labels web weights', () => {
    expect(isWebFont('sans')).toBe(false);
    expect(fontLabel('sans')).toBe('Sans, bold');
    expect(fontLabel({ family: 'Lobster', weight: 400 })).toBe('Lobster');
    expect(fontLabel({ family: 'Roboto', weight: 700 })).toBe('Roboto, 700');
  });
  it('loads the catalog once with categories and upright weights', async () => {
    expect(loadFontCatalog()).toBe(loadFontCatalog());
    const catalog = await loadFontCatalog();
    expect(catalog.length).toBeGreaterThan(1800);
    expect(catalog.find(f => f.family === 'Lobster')).toEqual({ family: 'Lobster', category: 'display', weights: [400] });
  });
});
