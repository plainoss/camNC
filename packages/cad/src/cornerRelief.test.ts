import { describe, expect, it } from 'vitest';
import {
  addFaceSketch,
  addLine,
  addRectangle,
  cadSketchRegions,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  pointInPolygon,
  setCadVariable,
  setCutDepth,
  type CadDocument,
  type CadPoint,
} from './index';

/** Points just inside the bit's circle that cuts into a corner, centred on its bisector. */
const bit = (corner: CadPoint, toward: CadPoint, diameter: number) => {
  const r = diameter / 2,
    length = Math.hypot(toward.x, toward.y),
    centre = { x: corner.x + (r * toward.x) / length, y: corner.y + (r * toward.y) / length };
  return Array.from({ length: 36 }, (_, i) => ({
    // The bone's arc is drawn in short chords, which cut a few thousandths inside the true circle.
    x: centre.x + (r - 0.02) * Math.cos((i * Math.PI) / 18),
    y: centre.y + (r - 0.02) * Math.sin((i * Math.PI) / 18),
  }));
};
const relieved = (document: CadDocument, diameter: number) => {
  document.parts[0]!.cornerRelief = { diameter };
  return evaluateCadDocument(document);
};

describe('inside corners relieved for a round bit', () => {
  it('puts a bone in each corner of a square hole, big enough for the bit to reach the corner', () => {
    const document = createPlateDocument({ width: 100, height: 60 });
    document.parts[0]!.sketch = addRectangle(document.parts[0]!.sketch, { x: 30, y: 20, width: 40, height: 20 });
    const { parts, diagnostics } = relieved(document, 6);
    const hole = parts[0]!.holes[0]!;
    expect(diagnostics).toEqual([]);
    for (const [corner, toward] of [
      [
        { x: 30, y: 20 },
        { x: 1, y: 1 },
      ],
      [
        { x: 70, y: 20 },
        { x: -1, y: 1 },
      ],
      [
        { x: 70, y: 40 },
        { x: -1, y: -1 },
      ],
      [
        { x: 30, y: 40 },
        { x: 1, y: -1 },
      ],
    ] as const)
      expect(bit(corner, toward, 6).every(p => pointInPolygon(p, hole))).toBe(true);
    // The loops CAM reads carry the same bones.
    expect(parts[0]!.loops.find(loop => loop.kind === 'hole')!.points).toEqual(hole);
  });

  it('cuts a bone into the part at a notch in its outline', () => {
    const document = createPlateDocument({ width: 100, height: 60 });
    const part = createCadPart('L', 18);
    // An L: 100 × 60 with a 40 × 30 notch out of the top right.
    for (const [x1, y1, x2, y2] of [
      [0, 0, 100, 0],
      [100, 0, 100, 30],
      [100, 30, 60, 30],
      [60, 30, 60, 60],
      [60, 60, 0, 60],
      [0, 60, 0, 0],
    ] as const)
      part.sketch = addLine(part.sketch, { x1, y1, x2, y2 });
    document.parts = [part];
    const { parts } = relieved(document, 6);
    expect(bit({ x: 60, y: 30 }, { x: 1, y: 1 }, 6).every(p => !pointInPolygon(p, parts[0]!.outline))).toBe(true);
  });

  it('leaves a rebate’s corners on the part’s edge square, and relieves the ones inside', () => {
    const plate = createPlateDocument({ width: 100, height: 60 });
    const { document, sketchId } = addFaceSketch(plate, plate.parts[0]!.id, 'top');
    const part = document.parts[0]!;
    const face = part.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === sketchId)!;
    if (face.type !== 'sketch') throw new Error('expected a sketch');
    face.sketch = addRectangle(face.sketch, { x: 0, y: 0, width: 20, height: 60 });
    const region = cadSketchRegions(part, face.sketch.id).find(candidate => pointInPolygon({ x: 10, y: 30 }, candidate.points))!;
    const cut = setCutDepth(document, part.id, face.sketch.id, region.id, 8);
    const outline = relieved(cut, 6).parts[0]!.cuts![0]!.outline;
    // A rebate along the left edge only has corners on the edge, so it keeps its four points.
    expect(outline).toHaveLength(4);
  });

  it('keeps corners too tight for a bone square and says how many', () => {
    const document = createPlateDocument({ width: 100, height: 60 });
    document.parts[0]!.sketch = addRectangle(document.parts[0]!.sketch, { x: 30, y: 20, width: 5, height: 5 });
    const { parts, diagnostics } = relieved(document, 6);
    expect(parts[0]!.holes[0]).toHaveLength(4);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'corner-relief-skipped',
        severity: 'warning',
        message: '4 corners are too tight for a 6 mm bone and stay square.',
      }),
    ]);
  });

  it('follows a bit variable', () => {
    let document = createPlateDocument({ width: 100, height: 60 });
    document.parts[0]!.cornerRelief = { diameter: 6, diameterExpression: 'bit' };
    for (const expression of ['6mm', '8mm']) {
      const result = setCadVariable(document, { id: document.variables?.[0]?.id, name: 'bit', expression });
      if ('error' in result) throw new Error(result.error);
      document = result.document;
    }
    expect(document.parts[0]!.cornerRelief).toEqual({ diameter: 8, diameterExpression: 'bit' });
  });
});
