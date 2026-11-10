import {
  addCopyFaceSketch,
  addPartCut,
  addRectangle,
  cadPartReference,
  cadSketchRegions,
  createCadDocument,
  createCadPart,
  setCutDepth,
  setPartPattern,
  solveCadDocument,
} from '@wbcnc/cad';
import type { BufferGeometry } from 'three';
import { expect, it } from 'vitest';
import { partSolid } from './partSolid';

function volume(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position'),
    indices = geometry.index;
  let sum = 0;
  for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
    const a = indices ? indices.getX(i) : i,
      b = indices ? indices.getX(i + 1) : i + 1,
      c = indices ? indices.getX(i + 2) : i + 2;
    sum +=
      positions.getX(a) * (positions.getY(b) * positions.getZ(c) - positions.getZ(b) * positions.getY(c)) +
      positions.getY(a) * (positions.getZ(b) * positions.getX(c) - positions.getX(b) * positions.getZ(c)) +
      positions.getZ(a) * (positions.getX(b) * positions.getY(c) - positions.getY(b) * positions.getX(c));
  }
  return Math.abs(sum / 6);
}

it.each([false, true])('keeps a selected copy’s Cut parts notch and own face cut in its sketch backdrop, mirrored %s', async mirrored => {
  const shelf = createCadPart('Shelf', 18),
    chase = createCadPart('Chase', 300);
  shelf.sketch = addRectangle(shelf.sketch, { x: 0, y: 0, width: 300, height: 200, dimensioned: true, positioned: true });
  shelf.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  chase.sketch = addRectangle(chase.sketch, { x: 40, y: -10, width: 20, height: 40, dimensioned: true, positioned: true });
  chase.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  let document = setPartPattern({ ...createCadDocument(), parts: [shelf, chase] }, shelf.id, { axis: 'z', count: 3, spacing: 100 });
  const copyId = document.parts[0]!.copies![0]!.id;
  if (mirrored) {
    delete document.parts[0]!.pattern;
    delete document.parts[0]!.copies![1]!.pattern;
    document.parts[0]!.copies![0] = { id: copyId, mirrored: true, placement: { position: [300, 0, 100], rotation: [0, 0, 0, 1] } };
  }
  const added = addCopyFaceSketch(document, shelf.id, copyId, 'top');
  document = added.document;
  const face = document.parts[0]!.features![0]!;
  if (face.type !== 'sketch') throw new Error('No face sketch');
  face.sketch = addRectangle(face.sketch, { x: 100, y: 50, width: 10, height: 10, dimensioned: true, positioned: true });
  const region = cadSketchRegions(document.parts[0]!, face.sketch.id).find(region =>
    region.points.every(point => point.x >= 100 && point.x <= 110 && point.y >= 50 && point.y <= 60)
  )!;
  document = setCutDepth(document, shelf.id, face.sketch.id, region.id, 'through');
  document = addPartCut(document, [chase.id], [cadPartReference(shelf.id, copyId)], { value: 0 }).document;
  const solved = await solveCadDocument(document);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.diagnostics).toEqual([]);
  for (const selected of [undefined, copyId, solved.document.parts[0]!.copies![1]!.id]) {
    const solid = partSolid(solved.document.parts[0]!, solved.document, selected);
    expect(solid.problem).toBeUndefined();
    const geometry = solid.geometry!;
    try {
      expect(volume(geometry)).toBeCloseTo(300 * 200 * 18 - (selected === copyId ? (20 * 30 + 10 * 10) * 18 : 0), 5);
      if (selected === copyId) {
        // Mirrored copies are sketched in their original local frame, so the world40..60 chase removes local240..260.
        const xs = Array.from(geometry.getAttribute('position').array).filter((_, index) => index % 3 === 0);
        expect(xs).toContain(mirrored ? 240 : 40);
        expect(xs).toContain(mirrored ? 260 : 60);
      }
    } finally {
      geometry.dispose();
    }
  }
});
