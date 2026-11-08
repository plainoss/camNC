import { describe, expect, it } from 'vitest';
import {
  addConstraint,
  createCadDocument,
  createPlateDocument,
  evaluateCadPart,
  isFaceEdge,
  setCadVariable,
  solveCadDocument,
  withFaceEdges,
  type CadDimension,
  type CadDocument,
  type CadDrawnOn,
  type CadPart,
  type CadPointEntity,
} from './index';

/** A plate whose width and height follow expressions. */
function plate(name: string, width: string, height: string, thickness: number, drawnOn: CadDrawnOn, size = 100): CadPart {
  const part = { ...createPlateDocument({ width: size, height: size, thickness }).parts[0]!, name, drawnOn };
  const dimension = (label: string) => part.sketch.constraints.find((c): c is CadDimension => c.label === label && 'value' in c)!;
  dimension('Width').expression = width;
  dimension('Height').expression = height;
  return part;
}
const pointAt = (part: CadPart, x: number, y: number, faceEdge: boolean) =>
  part.sketch.entities.find(
    (e): e is CadPointEntity => e.type === 'point' && isFaceEdge(e) === faceEdge && Math.hypot(e.x - x, e.y - y) < 1e-6
  )!;
async function withVariables(document: CadDocument, variables: Record<string, string>) {
  for (const [name, expression] of Object.entries(variables)) {
    const id = document.variables?.find(variable => variable.name === name)?.id;
    const result = setCadVariable(document, { ...(id && { id }), name, expression });
    if ('error' in result) throw new Error(result.error);
    document = result.document;
  }
  const solved = await solveCadDocument(document);
  expect(solved.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  return solved.document;
}
const outlineSize = (part: CadPart) => {
  const outline = evaluateCadPart(part).part!.outline;
  const xs = outline.map(p => p.x),
    ys = outline.map(p => p.y);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map(v => Math.round(v * 1000) / 1000);
};

describe('the edges of the face a part is drawn on', () => {
  it('shows a top face’s outline lines in the sketch drawn on it, fixed and as construction', () => {
    const bottom = plate('Bottom', '600mm', '300mm', 18, { on: { plane: 'top' }, offset: 0 });
    const top = { ...plate('Top', '100mm', '100mm', 18, { on: { partId: bottom.id, face: 'top' }, offset: 300 }) };
    const document = { ...createCadDocument(), parts: [bottom, top] };
    const sketch = withFaceEdges(document, top);
    const edges = sketch.entities.filter(isFaceEdge);
    expect(edges.filter(e => e.type === 'line')).toHaveLength(4);
    expect(edges.filter(e => e.type === 'point')).toHaveLength(4);
    expect(edges.every(e => e.construction && (e.type !== 'point' || e.fixed))).toBe(true);
    // Not solved yet, so the bottom is still as drawn: 100 by 100.
    expect(pointAt({ ...top, sketch }, 100, 100, true)).toBeDefined();
    // Nothing changes when they're already there.
    expect(withFaceEdges(document, { ...top, sketch })).toBe(sketch);
  });

  it('keeps a part tied to the face edges it was drawn onto as the part below changes', async () => {
    const bottom = plate('Bottom', 'width', 'depth', 18, { on: { plane: 'top' }, offset: 0 });
    let top = plate('Top', '300mm', '300mm', 18, { on: { partId: bottom.id, face: 'top' }, offset: 300 }, 300);
    let document: CadDocument = await withVariables({ ...createCadDocument(), parts: [bottom, top] }, { width: '300mm', depth: '300mm' });
    top = document.parts[1]!;
    // Tie the top's far corner to the bottom's, in place of its own size.
    let sketch = { ...top.sketch, constraints: top.sketch.constraints.filter(c => c.label !== 'Width' && c.label !== 'Height') };
    const own = pointAt(top, 300, 300, false),
      face = pointAt(top, 300, 300, true);
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: own.id, pointBId: face.id });
    document = { ...document, parts: [document.parts[0]!, { ...top, sketch }] };
    document = await withVariables(document, { width: '600mm' });
    expect(outlineSize(document.parts[1]!)).toEqual([600, 300]);
    document = await withVariables(document, { depth: '450mm' });
    expect(outlineSize(document.parts[1]!)).toEqual([600, 450]);
  });

  it('gives an edge face as a rectangle, as long as the edge and as high as the part is thick', async () => {
    const side = { ...plate('Side', '300mm', 'height', 18, { on: { plane: 'right' }, offset: 0 }), thicknessExpression: 'board' };
    const edge = side.sketch.entities.find(e => e.type === 'line')!;
    const shelf = plate('Shelf', '100mm', '100mm', 18, { on: { partId: side.id, face: { edge: edge.id } }, offset: 0 });
    let document = await withVariables({ ...createCadDocument(), parts: [shelf, side] }, { height: '500mm', board: '18mm' });
    const corners = () =>
      document.parts[0]!.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point' && isFaceEdge(e)).map(p =>
        [p.x, p.y].map(v => Math.round(v * 1000) / 1000)
      );
    const length = Math.max(...corners().map(([x]) => x!));
    expect(corners()).toEqual([
      [0, 0],
      [length, 0],
      [length, 18],
      [0, 18],
    ]);
    document = await withVariables(document, { board: '12mm' });
    expect(corners().map(([, y]) => y)).toEqual([0, 0, 12, 12]);
  });

  it('flips an underside’s edges as the underside is seen from below', () => {
    const bottom = plate('Bottom', '100mm', '50mm', 18, { on: { plane: 'top' }, offset: 0 });
    const under = plate('Under', '10mm', '10mm', 6, { on: { partId: bottom.id, face: 'underside' }, offset: 0 });
    const sketch = withFaceEdges({ ...createCadDocument(), parts: [bottom, under] }, under);
    const xs = sketch.entities.filter((e): e is CadPointEntity => e.type === 'point' && isFaceEdge(e)).map(p => p.x);
    expect(Math.min(...xs)).toBe(-100);
    expect(Math.max(...xs)).toBe(0);
  });

  it('lets go of edges that are gone, keeping only those something is still tied to, where they were', () => {
    const bottom = plate('Bottom', '100mm', '100mm', 18, { on: { plane: 'top' }, offset: 0 });
    const top = plate('Top', '100mm', '100mm', 6, { on: { partId: bottom.id, face: 'top' }, offset: 0 });
    let document: CadDocument = { ...createCadDocument(), parts: [bottom, top] };
    let sketch = withFaceEdges(document, top);
    const own = pointAt({ ...top, sketch }, 100, 100, false),
      corner = pointAt({ ...top, sketch }, 100, 100, true);
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: own.id, pointBId: corner.id });
    // Drawn on a plane now, so there's no face.
    const moved = { ...top, sketch, drawnOn: { on: { plane: 'front' as const }, offset: 0 } };
    document = { ...document, parts: [bottom, moved] };
    const after = withFaceEdges(document, moved);
    expect(after.entities.filter(isFaceEdge)).toEqual([]);
    const kept = after.entities.find(e => e.id === corner.id) as CadPointEntity;
    expect(kept).toMatchObject({ x: 100, y: 100, fixed: true, construction: true });
    expect(after.entities.filter(e => e.id.includes(':face:'))).toHaveLength(1);
  });
});
