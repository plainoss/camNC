import { describe, expect, it } from 'vitest';
import {
  addFaceSketch,
  addLine,
  addRectangle,
  cadSketchRegions,
  createPlateDocument,
  evaluateCadDocument,
  linearPatternSketchEntities,
  pointInPolygon,
  polygonArea,
  setCutDepth,
} from './index';

/** A 300 × 600 side with grooves sketched on its top face, the first one patterned up the side. */
function side(groove: 'inside' | 'across') {
  const plate = createPlateDocument({ width: 300, height: 600, thickness: 18 });
  const { document, sketchId } = addFaceSketch(plate, plate.parts[0]!.id, 'top');
  const face = document.parts[0]!.features!.find(f => f.type === 'sketch' && f.sketch.id === sketchId)!;
  if (face.type !== 'sketch') throw new Error('expected a sketch');
  const before = new Set(face.sketch.entities.map(e => e.id));
  // Inside the part, a closed rectangle. Across it, two lines from edge to edge, so the part's outline closes the groove.
  face.sketch =
    groove === 'inside'
      ? addRectangle(face.sketch, { x: 20, y: 100, width: 260, height: 18 })
      : addLine(addLine(face.sketch, { x1: -10, y1: 100, x2: 310, y2: 100 }), { x1: -10, y1: 118, x2: 310, y2: 118 });
  const drawn = face.sketch.entities.filter(e => !before.has(e.id) && e.type === 'line').map(e => e.id);
  const result = linearPatternSketchEntities(face.sketch, { entityIds: drawn, countX: 3, stepX: { x: 0, y: 150 } });
  if (!result.ok) throw new Error(result.message);
  face.sketch = result.sketch;
  // The groove itself, not the face around it that has it as a hole.
  const first = cadSketchRegions(document.parts[0]!, sketchId)
    .filter(region => pointInPolygon({ x: 150, y: 109 }, region.points))
    .sort((a, b) => Math.abs(polygonArea(a.points)) - Math.abs(polygonArea(b.points)))[0]!;
  return setCutDepth(document, document.parts[0]!.id, sketchId, first.id, 6);
}

describe('cutting a patterned groove', () => {
  it.each(['inside', 'across'] as const)('cuts every copy of a groove drawn %s the part', groove => {
    const { parts, diagnostics } = evaluateCadDocument(side(groove));
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const middles = parts[0]!.cuts!.map(cut => Math.round(cut.outline.reduce((sum, p) => sum + p.y, 0) / cut.outline.length));
    expect(middles.sort((a, b) => a - b)).toEqual([109, 259, 409]);
  });

  it('cuts only the matching side of each copy of a line that divides the part', () => {
    const plate = createPlateDocument({ width: 300, height: 600, thickness: 18 });
    const { document, sketchId } = addFaceSketch(plate, plate.parts[0]!.id, 'top');
    const face = document.parts[0]!.features!.find(f => f.type === 'sketch' && f.sketch.id === sketchId)!;
    if (face.type !== 'sketch') throw new Error('expected a sketch');
    face.sketch = addLine(face.sketch, { x1: -10, y1: 100, x2: 310, y2: 100 });
    const line = face.sketch.entities.filter(e => e.type === 'line').at(-1)!;
    const result = linearPatternSketchEntities(face.sketch, { entityIds: [line.id], countX: 3, stepX: { x: 0, y: 150 } });
    if (!result.ok) throw new Error(result.message);
    face.sketch = result.sketch;
    const below = cadSketchRegions(document.parts[0]!, sketchId).find(region => pointInPolygon({ x: 150, y: 50 }, region.points))!;
    const cut = setCutDepth(document, document.parts[0]!.id, sketchId, below.id, 6);
    const extents = evaluateCadDocument(cut).parts[0]!.cuts!.map(c => [
      Math.min(...c.outline.map(p => p.y)),
      Math.max(...c.outline.map(p => p.y)),
    ]);
    // The strip below the first line is cut; a copy of it would sit 150 mm higher, between two lines, where no copy of the region exists.
    expect(extents).toEqual([[0, 100]]);
  });
});
