import { expect, it } from 'vitest';
import { addLine, createCadDocument, createCadPart, createPlateDocument, designSteps, parseCadDocument } from '@wbcnc/cad';
import { editCad } from '../edit';
import { applyCadProposal, cadProposal } from '@wbcnc/cad-editor/proposal';
import { cadSession, endCadSession, undoCadSession } from '@wbcnc/cad-editor/session';
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

// createDesignJob starts from this exact native draft shape. Its absent extrude
// flag is an enabled implicit feature, not an already-disabled empty placeholder.
const blankDesignJobDraft = () => {
  const draft = { ...createCadDocument('New design'), lengthUnit: 'cm' as const };
  draft.parts.push(createCadPart('Part 1'));
  return draft;
};
it('imports into the real blank-studio shape while preserving the starter and document history', async () => {
  const base = blankDesignJobDraft(),
    before = structuredClone(base),
    starter = base.parts[0],
    store = createSvgAssetStore(),
    asset = store.register(source);
  expect(designSteps(base).find(step => step.kind === 'extrude')).toMatchObject({
    id: `${starter.id}:extrude`,
    partId: starter.id,
    suppressed: false,
  });
  const result = await checkSvgCandidate(base, store, { handle: asset.handle, toolpaths: true });
  expect(result.ok, JSON.stringify(result.report.errors)).toBe(true);
  expect(base).toEqual(before);
  expect(result.document).toMatchObject({ id: base.id, lengthUnit: 'cm', revision: base.revision + 1 });
  expect(result.document.parts[0]).toEqual({ ...starter, extrude: false });
  expect(result.document.parts[1].id).toBe(result.partId);
  expect(result.report.parts.find(part => part.name === 'Imported SVG')?.toolpaths).toBeDefined();
  expect(designSteps(result.document).filter(step => step.partId === starter.id)).toEqual([designSteps(base)[0]]);
  const session = cadSession(base);
  try {
    applyCadProposal(session, cadProposal(base, result.document));
    expect(session.past).toHaveLength(1);
    expect(undoCadSession(session).parts).toEqual(before.parts);
  } finally {
    endCadSession(base.id);
  }
  const reloaded = parseCadDocument(JSON.parse(JSON.stringify(result.document)));
  const repaired = await editCad(reloaded, d => d.part(starter.id).profile.rect({ at: [300, 0], w: 40, h: 30 }));
  expect(repaired.ok, JSON.stringify(repaired.report.errors)).toBe(true);
  expect(repaired.document.id).toBe(base.id);
  expect(repaired.document.revision).toBe(base.revision + 2);
  expect(repaired.document.parts[0]).toMatchObject({ id: starter.id, sketch: { id: starter.sketch.id }, extrude: false });
  expect(repaired.document.parts[0].sketch.entities[0]).toEqual(starter.sketch.entities[0]);
  expect(repaired.document.parts[0].sketch.entities.filter(entity => entity.type === 'line')).toHaveLength(4);
  expect(repaired.document.parts[1]).toEqual(reloaded.parts[1]);
});
it.each(['unfinished', 'renamed', 'named-extrude', 'configured'] as const)(
  'does not hide invalid non-pristine studio geometry: %s',
  async kind => {
    const base = blankDesignJobDraft(),
      starter = base.parts[0];
    if (kind === 'unfinished') starter.sketch = addLine(starter.sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    if (kind === 'renamed') starter.name = 'Profile to finish';
    if (kind === 'named-extrude') starter.extrudeName = 'Extrude to finish';
    if (kind === 'configured') starter.thickness = 40;
    const before = structuredClone(base),
      store = createSvgAssetStore(),
      asset = store.register(source);
    const result = await checkSvgCandidate(base, store, { handle: asset.handle });
    expect(result.ok).toBe(false);
    expect(result.report.errors.length).toBeGreaterThan(0);
    expect(base).toEqual(before);
    expect(result.document.parts[0]).toEqual(starter);
  }
);
