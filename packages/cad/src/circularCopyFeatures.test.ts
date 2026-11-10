import { expect, it } from 'vitest';
import {
  addCircle,
  addCopyFaceSketch,
  cadCopyName,
  cadPartsToCut,
  cadSketchRegions,
  createCadFolder,
  createPlateDocument,
  detachPartCopy,
  parseCadDocument,
  setCadVariable,
  setCutDepth,
  setPartPattern,
  solveCadDocument,
} from './index';

it('retains a circular copy’s cut and permanently excludes a detached slot through count edits and reload', async () => {
  let document = createPlateDocument({ name: 'Radial legs', width: 20, height: 30, thickness: 18 });
  const sourceId = document.parts[0]!.id;
  document.parts[0]!.name = 'Leg';
  document.parts[0]!.placement = { position: [100, 0, 0], rotation: [0, 0, 0, 1] };
  const count = setCadVariable(document, { name: 'legs', expression: '4' });
  if ('error' in count) throw new Error(count.error);
  document = setPartPattern(count.document, sourceId, {
    axis: 'x',
    spacing: 100,
    count: 4,
    countExpression: 'legs',
    circular: { origin: [0, 0, 0], axis: [0, 0, 1], angle: 360 },
  });
  const detachedCopyId = document.parts[0]!.copies![0]!.id;
  const cutCopyId = document.parts[0]!.copies![2]!.id;
  const face = addCopyFaceSketch(document, sourceId, cutCopyId, 'top');
  document = face.document;
  const sketch = document.parts[0]!.features!.find(feature => feature.type === 'sketch')!;
  if (sketch.type !== 'sketch') throw new Error('No copy sketch');
  sketch.sketch = addCircle(sketch.sketch, { x: 10, y: 15, radius: 3, dimensioned: true, positioned: true });
  const region = cadSketchRegions(document.parts[0]!, sketch.sketch.id).find(region =>
    region.points.every(point => Math.abs(point.x - 10) < 5)
  )!;
  document = setCutDepth(document, sourceId, sketch.sketch.id, region.id, 'through');
  const featureIds = document.parts[0]!.features!.map(feature => feature.id);
  const folder = createCadFolder(document, { name: 'Stool legs', partIds: [sourceId] });
  if ('error' in folder) throw new Error(folder.error);
  const detached = detachPartCopy(folder.document, sourceId, detachedCopyId, 'Independent leg');
  if ('error' in detached) throw new Error(detached.error);
  document = detached.document;
  const frozen = document.parts.find(part => part.id === detached.partId)!.placement;
  expect(frozen!.position).toEqual([0, 100, 0]);
  expect(document.parts[0]!.pattern!.excluded).toEqual([1]);
  expect(document.folders![0]!.partIds).toEqual([sourceId, detached.partId]);

  const shrink = setCadVariable(document, { id: count.id, name: 'legs', expression: '2' });
  if ('error' in shrink) throw new Error(shrink.error);
  let solved = await solveCadDocument(shrink.document);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.document.parts[0]!.copies ?? []).toEqual([]);
  expect(solved.diagnostics.some(diagnostic => diagnostic.code === 'copy-feature-inactive')).toBe(true);
  expect(solved.document.parts[0]!.features!.map(feature => feature.id)).toEqual(featureIds);
  const restored = setCadVariable(parseCadDocument(JSON.parse(JSON.stringify(solved.document))), {
    id: count.id,
    name: 'legs',
    expression: '4',
  });
  if ('error' in restored) throw new Error(restored.error);
  solved = await solveCadDocument(restored.document);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  const source = solved.document.parts[0]!;
  expect(source.copies!.map(copy => copy.id)).toEqual([`${source.pattern!.id}:2`, cutCopyId]);
  expect(source.copies!.map((_, index) => cadCopyName(source, index))).toEqual(['Leg 3', 'Leg 4']);
  expect(source.copies!.map(copy => copy.placement!.position)).toEqual([
    [-100, 0, 0],
    [0, -100, 0],
  ]);
  expect(solved.document.parts.find(part => part.id === detached.partId)!.placement).toEqual(frozen);
  expect(solved.parts.find(part => part.partId === sourceId)!.copyCuts![cutCopyId]).toHaveLength(1);
  expect(cadPartsToCut(solved.document, solved.parts).map(group => group.names)).toEqual([
    ['Leg', 'Leg 3'],
    ['Leg 4'],
    ['Independent leg'],
  ]);
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
});
