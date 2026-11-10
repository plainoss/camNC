import { expect, it } from 'vitest';
import { createCadDocument, createPlateDocument } from '@wbcnc/cad';
import { checkSvgCandidate, createDocumentSvgAssetRegistry, createSvgAssetStore } from './index';
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><rect width="100" height="50"/></svg>';
it('constructs a checked native candidate without executing source or mutating its base', async () => {
  const base = createPlateDocument(),
    before = structuredClone(base),
    store = createSvgAssetStore(),
    asset = store.register(source, 'tray.svg');
  const result = await checkSvgCandidate(base, store, {
    handle: asset.handle,
    partName: 'Tray',
    thickness: 40,
    placement: { width: 280, height: 190, preserveAspect: false, at: [200, 0] },
  });
  expect(base).toEqual(before);
  expect(result.ok).toBe(true);
  expect(result.document.id).toBe(base.id);
  expect(result.document.revision).toBe(base.revision + 1);
  expect(result.document.parts[0]).toEqual(base.parts[0]);
  expect(result.document.parts[1]).toMatchObject({ id: result.partId, name: 'Tray', thickness: 40 });
  expect(result.report.parts[1].outline).toMatchObject({ at: [200, 0], size: [280, 190] });
  expect(result.report.parts.every(p => !p.toolpaths)).toBe(true);
  expect(result.asset.handle).toBe(asset.handle);
});
it('validates explicit toolpaths and makes default names unique', async () => {
  const store = createSvgAssetStore(),
    asset = store.register(source);
  const first = await checkSvgCandidate(createCadDocument(), store, { handle: asset.handle, toolpaths: true });
  expect(first.ok).toBe(true);
  expect(first.report.parts[0].toolpaths).toBeDefined();
  const second = await checkSvgCandidate(first.document, store, { handle: asset.handle });
  expect(second.document.parts.map(p => p.name)).toEqual(['Imported SVG', 'Imported SVG 2']);
});
it('rejects unknown handles, duplicate names and invalid manufacturing inputs', async () => {
  const base = createPlateDocument(),
    store = createSvgAssetStore(),
    asset = store.register(source);
  await expect(checkSvgCandidate(base, store, { handle: 'unknown' })).rejects.toThrow(/Unknown SVG/);
  await expect(checkSvgCandidate(base, store, { handle: asset.handle, partName: base.parts[0].name })).rejects.toThrow(/already/);
  for (const thickness of [0, NaN, Infinity, 10_001])
    await expect(checkSvgCandidate(base, store, { handle: asset.handle, thickness })).rejects.toThrow(/thickness/);
  await expect(checkSvgCandidate(base, store, { handle: asset.handle, partName: '\n' })).rejects.toThrow(/name/);
});
it('isolates document asset handles and releases retained source explicitly', () => {
  const registry = createDocumentSvgAssetRegistry(),
    first = registry.forDocument('doc1'),
    second = registry.forDocument('doc2');
  const a = first.register(source),
    b = second.register(source);
  expect(a.handle).not.toBe(b.handle);
  expect(() => second.get(a.handle)).toThrow(/Unknown SVG/);
  expect(registry.forDocument('doc1')).toBe(first);
  expect(registry.release('doc1')).toBe(true);
  expect(first.list()).toEqual([]);
  expect(registry.forDocument('doc1')).not.toBe(first);
  registry.clear();
  expect(second.list()).toEqual([]);
});
