import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addCopyFaceSketch,
  addFaceSketch,
  addPartCopy,
  cadPartsToCut,
  cadSketchRegions,
  createCadFolder,
  createPlateDocument,
  designSteps,
  detachPartCopy,
  evaluatedPartCopy,
  parseCadDocument,
  polygonArea,
  setCadVariable,
  setCopyCutDepth,
  setCutDepth,
  setPartPattern,
  solveCadDocument,
  type CadDimension,
  type CadDocument,
} from './index';

function shelves() {
  let document = createPlateDocument({ width: 300, height: 200, thickness: 18 });
  const part = document.parts[0]!;
  part.name = 'Shelf';
  part.placement = { position: [40, 60, 100], rotation: [0, 0, 0, 1] };
  document = setPartPattern(document, part.id, { axis: 'z', count: 3, spacing: 100 });
  return document;
}

function hole(document: CadDocument, copyId: string, on: 'top' | { floorOf: string } = 'top', depth: number | 'through' = 'through') {
  const partId = document.parts[0]!.id;
  const made = addCopyFaceSketch(document, partId, copyId, on);
  document = made.document;
  const face = document.parts[0]!.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === made.sketchId)!;
  if (face.type !== 'sketch') throw new Error('No face sketch');
  face.sketch = addCircle(face.sketch, { x: 150, y: 100, radius: on === 'top' ? 10 : 5, dimensioned: true, positioned: true });
  const region = cadSketchRegions(document.parts[0]!, face.sketch.id).find(region =>
    region.points.every(point => Math.abs(point.x - 150) < 20)
  )!;
  document = setCutDepth(document, partId, face.sketch.id, region.id, depth);
  return { document, sketchId: made.sketchId, cutId: document.parts[0]!.features!.at(-1)!.id };
}

function familyPocket(document: CadDocument, on: 'top' | { floorOf: string }, radius: number, depth: number) {
  const partId = document.parts[0]!.id;
  const made = addFaceSketch(document, partId, on);
  document = made.document;
  const face = document.parts[0]!.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === made.sketchId)!;
  if (face.type !== 'sketch') throw new Error('No face sketch');
  face.sketch = addCircle(face.sketch, { x: 150, y: 100, radius, dimensioned: true, positioned: true });
  const region = cadSketchRegions(document.parts[0]!, face.sketch.id).find(region =>
    region.points.every(point => Math.abs(point.x - 150) <= radius + 1e-6)
  )!;
  document = setCutDepth(document, partId, face.sketch.id, region.id, depth);
  return { document, sketchId: made.sketchId, regionId: region.id, cutId: document.parts[0]!.features!.at(-1)!.id };
}

describe('features on one physical copy', () => {
  it('cuts only the second shelf and groups the uncut siblings for machining', async () => {
    let document = shelves();
    const sourceId = document.parts[0]!.id;
    const copyId = document.parts[0]!.copies![0]!.id;
    document = hole(document, copyId).document;
    expect(document.version).toBe(3);
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    const source = solved.parts.find(part => part.partId === sourceId)!;
    expect(source.cuts ?? []).toEqual([]);
    expect(source.copyCuts![copyId]!.map(cut => [cut.through, cut.to])).toEqual([[true, 18]]);
    const groups = cadPartsToCut(solved.document, solved.parts);
    expect(groups.map(group => group.names)).toEqual([['Shelf', 'Shelf 3'], ['Shelf 2']]);
    expect(groups[1]!.part.partId).not.toBe(sourceId);
    expect(groups[0]!.part.cuts ?? []).toEqual([]);
    expect(groups[1]!.part.cuts).toHaveLength(1);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
    expect(() => parseCadDocument({ ...document, version: 2 })).toThrow('version 3');
  });

  it('retains an absent copy’s feature IDs through width and count edits and reload', async () => {
    let document = shelves();
    const id = document.parts[0]!.id;
    const copyId = document.parts[0]!.copies![1]!.id;
    const made = hole(document, copyId);
    document = made.document;
    const initialIds = document.parts[0]!.features!.map(feature => feature.id);
    const variable = setCadVariable(document, { name: 'width', expression: '300 mm' });
    if ('error' in variable) throw new Error(variable.error);
    document = variable.document;
    document.parts[0]!.sketch.constraints.find(
      (constraint): constraint is CadDimension => constraint.label === 'Width' && 'value' in constraint
    )!.expression = 'width';
    const changed = setCadVariable(document, { id: variable.id, name: 'width', expression: '400 mm' });
    if ('error' in changed) throw new Error(changed.error);
    document = setPartPattern(changed.document, id, { axis: 'z', count: 2, spacing: 100 });
    let solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.diagnostics.some(item => item.code === 'copy-feature-inactive')).toBe(true);
    expect(solved.parts[0]!.copyCuts).toBeUndefined();
    expect(designSteps(solved.document).find(step => step.id === made.cutId)?.broken).toMatch(/absent/);
    document = setPartPattern(parseCadDocument(JSON.parse(JSON.stringify(solved.document))), id, { axis: 'z', count: 3, spacing: 100 });
    solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.document.parts[0]!.features!.map(feature => feature.id)).toEqual(initialIds);
    expect(solved.parts[0]!.copyCuts![copyId]).toHaveLength(1);
    expect(Math.max(...solved.parts[0]!.outline.map(point => point.x))).toBeCloseTo(400, 6);
    expect(cadPartsToCut(solved.document, solved.parts).map(group => group.names)).toEqual([['Shelf', 'Shelf 2'], ['Shelf 3']]);
  });

  it('supports a copy cut on a family region without changing the family cut', async () => {
    let document = shelves();
    const part = document.parts[0]!;
    part.sketch = addCircle(part.sketch, { x: 100, y: 100, radius: 6, dimensioned: true, positioned: true });
    const region = cadSketchRegions(part, part.sketch.id).find(region => region.curveIds.length === 1)!;
    document = setCutDepth(document, part.id, part.sketch.id, region.id, 4);
    const copyId = part.copies![0]!.id;
    document = setCopyCutDepth(document, part.id, copyId, part.sketch.id, region.id, 8);
    document = setCopyCutDepth(document, part.id, copyId, part.sketch.id, region.id, 9);
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts[0]!.cuts!.map(cut => cut.to)).toEqual([4]);
    expect(solved.parts[0]!.copyCuts![copyId]!.map(cut => cut.to)).toEqual([9]);
  });
  it('keeps shared and copy-specific child floors attached when a copy overrides a family pocket', async () => {
    let document = shelves();
    const sourceId = document.parts[0]!.id;
    const copyId = document.parts[0]!.copies![0]!.id;
    const parent = familyPocket(document, 'top', 40, 4);
    const child = familyPocket(parent.document, { floorOf: parent.cutId }, 5, 3);
    document = child.document;
    let solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts[0]!.cuts!.map(cut => [cut.from, cut.to])).toEqual([
      [0, 4],
      [4, 7],
    ]);
    const originalIds = document.parts[0]!.features!.map(feature => feature.id);
    document = setCopyCutDepth(document, sourceId, copyId, parent.sketchId, parent.regionId, 8);
    const override = document.parts[0]!.features!.find(feature => feature.type === 'cut' && feature.copyId === copyId)!;
    expect(document.parts[0]!.features!.filter(feature => originalIds.includes(feature.id)).map(feature => feature.id)).toEqual(
      originalIds
    );
    expect(document.parts[0]!.features!.findIndex(feature => feature.id === override.id)).toBeLessThan(
      document.parts[0]!.features!.findIndex(feature => feature.type === 'sketch' && feature.sketch.id === child.sketchId)
    );
    const sharedFloor = document.parts[0]!.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === child.sketchId)!;
    if (sharedFloor.type !== 'sketch') throw new Error('No shared floor');
    expect(sharedFloor.on).toEqual({ floorOf: parent.cutId });
    solved = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(document))));
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts[0]!.cuts!.map(cut => [cut.from, cut.to])).toEqual([
      [0, 4],
      [4, 7],
    ]);
    expect(solved.parts[0]!.copyCuts![copyId]!.map(cut => [cut.from, cut.to])).toEqual([
      [0, 8],
      [8, 11],
    ]);

    // Both saved ways of naming that physical floor remain valid: the shared parent and the copy override itself.
    document = hole(solved.document, copyId, { floorOf: parent.cutId }, 1).document;
    document = hole(document, copyId, { floorOf: override.id }, 2).document;
    solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts[0]!.copyCuts![copyId]!.map(cut => [cut.from, cut.to])).toEqual([
      [0, 8],
      [8, 11],
      [8, 9],
      [8, 10],
    ]);
    const detached = detachPartCopy(solved.document, sourceId, copyId);
    if ('error' in detached) throw new Error(detached.error);
    const detachedSolved = await solveCadDocument(parseCadDocument(detached.document));
    expect(detachedSolved.status, JSON.stringify(detachedSolved.diagnostics)).toBe('solved');
    expect(detachedSolved.parts.find(part => part.partId === detached.partId)!.cuts!.map(cut => [cut.from, cut.to])).toEqual([
      [0, 8],
      [8, 11],
      [8, 9],
      [8, 10],
    ]);
  });
  it('preserves actual material when one copy fills a through-hole and another makes it a blind pocket', async () => {
    let document = shelves();
    const part = document.parts[0]!;
    part.sketch = addCircle(part.sketch, { x: 100, y: 100, radius: 6, dimensioned: true, positioned: true });
    const region = cadSketchRegions(part, part.sketch.id).find(region => region.curveIds.length === 1)!;
    const [filled, pocket] = part.copies!;
    document = setCopyCutDepth(document, part.id, filled!.id, part.sketch.id, region.id, 0);
    document = setCopyCutDepth(document, part.id, pocket!.id, part.sketch.id, region.id, 8);
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts[0]!.holes).toHaveLength(1);
    const solid = evaluatedPartCopy(solved.parts[0]!, filled!);
    const blind = evaluatedPartCopy(solved.parts[0]!, pocket!);
    expect(solid.holes).toEqual([]);
    expect(solid.cuts ?? []).toEqual([]);
    expect(blind.holes).toEqual([]);
    expect(blind.cuts!.map(cut => cut.to)).toEqual([8]);
    const groups = cadPartsToCut(solved.document, solved.parts);
    expect(groups.map(group => [group.names, group.part.holes.length, group.part.cuts?.length ?? 0])).toEqual([
      [['Shelf'], 1, 0],
      [['Shelf 2'], 0, 0],
      [['Shelf 3'], 0, 1],
    ]);
  });
  it('rebuilds copy-specific cuts when a variable changes the pattern count', async () => {
    let document = shelves();
    const source = document.parts[0]!;
    const copyId = source.copies![1]!.id;
    document = hole(document, copyId).document;
    const count = setCadVariable(document, { name: 'shelves', expression: '3' });
    if ('error' in count) throw new Error(count.error);
    document = setPartPattern(count.document, source.id, { axis: 'z', count: 3, countExpression: 'shelves', spacing: 100 });
    const shrink = setCadVariable(document, { id: count.id, name: 'shelves', expression: '2' });
    if ('error' in shrink) throw new Error(shrink.error);
    const absent = await solveCadDocument(shrink.document);
    expect(absent.status, JSON.stringify(absent.diagnostics)).toBe('solved');
    expect(absent.parts[0]!.copyCuts).toBeUndefined();
    expect(absent.diagnostics.some(diagnostic => diagnostic.code === 'copy-feature-inactive')).toBe(true);
    const grow = setCadVariable(absent.document, { id: count.id, name: 'shelves', expression: '3' });
    if ('error' in grow) throw new Error(grow.error);
    const restored = await solveCadDocument(grow.document);
    expect(restored.status, JSON.stringify(restored.diagnostics)).toBe('solved');
    expect(restored.parts[0]!.copyCuts![copyId]).toHaveLength(1);
  });
});

describe('detaching a copy', () => {
  it('preserves a pocket and its nested floor, remaps every ID and permanently skips that logical pattern slot', async () => {
    let document = shelves();
    const sourceId = document.parts[0]!.id;
    const copyId = document.parts[0]!.copies![0]!.id;
    const first = hole(document, copyId, 'top', 4);
    document = hole(first.document, copyId, { floorOf: first.cutId }, 3).document;
    const before = await solveCadDocument(document);
    expect(before.status).toBe('solved');
    const placement = before.document.parts[0]!.copies![0]!.placement;
    const made = detachPartCopy(before.document, sourceId, copyId, 'Cable shelf');
    if ('error' in made) throw new Error(made.error);
    document = made.document;
    expect(document.parts[0]!.pattern!.excluded).toEqual([1]);
    expect(document.parts[1]!.placement).toEqual(placement);
    expect(document.parts[1]!.features!.every(feature => !feature.copyId)).toBe(true);
    let solved = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(document))));
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(solved.parts.find(part => part.partId === made.partId)!.cuts!.map(cut => [cut.from, cut.to])).toEqual([
      [0, 4],
      [4, 7],
    ]);
    const frozen = structuredClone(solved.document.parts[1]!.placement);
    document = setPartPattern(solved.document, sourceId, { axis: 'z', count: 2, spacing: 300 });
    document = setPartPattern(document, sourceId, { axis: 'z', count: 4, spacing: 300 });
    solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.document.parts[0]!.copies!.map(copy => copy.id)).toEqual([
      `${solved.document.parts[0]!.pattern!.id}:2`,
      `${solved.document.parts[0]!.pattern!.id}:3`,
    ]);
    expect(solved.document.parts[1]!.placement).toEqual(frozen);
    expect(solved.document.parts[1]!.name).toBe('Cable shelf');
  });

  it('puts a detached part in the same folder and leaves source geometry independently editable', async () => {
    let document = shelves();
    const source = document.parts[0]!;
    const group = createCadFolder(document, { name: 'Cabinet', partIds: [source.id] });
    if ('error' in group) throw new Error(group.error);
    const made = detachPartCopy(group.document, source.id, source.copies![0]!.id);
    if ('error' in made) throw new Error(made.error);
    document = made.document;
    expect(document.folders![0]!.partIds).toEqual(document.parts.map(part => part.id));
    expect(parseCadDocument(document)).toEqual(document);
    document.parts[1]!.sketch.constraints.find(
      (constraint): constraint is CadDimension => constraint.label === 'Width' && 'value' in constraint
    )!.value = 150;
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts.map(part => Math.max(...part.outline.map(point => point.x)))).toEqual([300, 150]);
  });
  it('detaches a mirrored board with a curved profile hole and a pocket into ordinary editable source', async () => {
    let document = createPlateDocument({ width: 150, height: 100, thickness: 18 });
    const source = document.parts[0]!;
    source.placement = { position: [10, 20, 30], rotation: [0, 0, 0, 1] };
    source.sketch = addCircle(source.sketch, { x: 30, y: 40, radius: 6, dimensioned: true, positioned: true });
    const region = cadSketchRegions(source, source.sketch.id).find(region => region.curveIds.length === 1)!;
    document = setCutDepth(document, source.id, source.sketch.id, region.id, 5);
    const added = addPartCopy(document, source.id, { mirrored: true, offset: { position: [250, 0, 0], rotation: [0, 0, 0, 1] } });
    const before = await solveCadDocument(added.document);
    const group = cadPartsToCut(before.document, before.parts).find(group => group.names.length === 1 && group.names[0] !== source.name)!;
    const detached = detachPartCopy(before.document, source.id, added.id, 'Left side');
    if ('error' in detached) throw new Error(detached.error);
    const solved = await solveCadDocument(parseCadDocument(detached.document));
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    const shape = solved.parts.find(part => part.partId === detached.partId)!;
    expect(shape.outline.map(point => [point.x + 0, point.y + 0])).toEqual(group.part.outline.map(point => [point.x + 0, point.y + 0]));
    expect(shape.cuts!.map(cut => [cut.side, cut.from, cut.to])).toEqual(group.part.cuts!.map(cut => [cut.side, cut.from, cut.to]));
    expect(Math.abs(polygonArea(shape.cuts![0]!.outline))).toBeCloseTo(Math.abs(polygonArea(group.part.cuts![0]!.outline)), 5);
    expect(solved.document.parts.find(part => part.id === detached.partId)!.sketch.entities.some(entity => entity.type === 'line')).toBe(
      true
    );
  });
});
