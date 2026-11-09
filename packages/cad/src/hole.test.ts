import { describe, expect, it } from 'vitest';
import { addLine, addPoint, createCadDocument, createCadPart, createPlateDocument } from './document';
import { evaluateCadDocument } from './features';
import { polygonArea } from './geometry';
import { resolveExtrudeSteps } from './extrudeSteps';
import { cadVariableUses, setCadVariable } from './variables';

describe('a Hole step', () => {
  it('cuts a round hole at each point of its sketch, as wide as it says and as deep', () => {
    const board = { ...createPlateDocument({ width: 100, height: 60, thickness: 18 }).parts[0]!, name: 'Board' };
    board.drawnOn = { on: { plane: 'top' as const }, offset: 0 };
    const holes = { ...createCadPart('Holes', 18), drawnOn: { on: { partId: board.id, face: 'top' as const }, offset: 0 } };
    holes.sketch = addPoint(addPoint(holes.sketch, { x: 20, y: 30 }), { x: 80, y: 30 });
    // A line only places points: its ends aren't holes.
    holes.sketch = addLine(holes.sketch, { x1: 20, y1: 10, x2: 80, y2: 10, construction: true });
    const step = { ...holes, remove: { depth: 'through' as const }, hole: { diameter: 8 } };
    const document = resolveExtrudeSteps({ ...createCadDocument(), parts: [board, step] });
    const cuts = evaluateCadDocument(document).parts.find(part => part.partId === board.id)!.cuts!;
    expect(cuts).toHaveLength(2);
    for (const cut of cuts) {
      expect(cut.through).toBe(true);
      expect(Math.abs(polygonArea(cut.outline))).toBeCloseTo(Math.PI * 16, 0);
    }
    // The same design gives the same holes, so nothing changes when it's resolved again.
    expect(resolveExtrudeSteps(document)).toBe(document);
  });

  it('follows a variable for its diameter, and counts as a use of it', () => {
    const board = { ...createPlateDocument({ width: 100, height: 60, thickness: 18 }).parts[0]!, name: 'Board' };
    board.drawnOn = { on: { plane: 'top' as const }, offset: 0 };
    const holes = { ...createCadPart('Holes', 18), drawnOn: { on: { partId: board.id, face: 'top' as const }, offset: 0 } };
    holes.sketch = addPoint(holes.sketch, { x: 20, y: 30 });
    const step = { ...holes, remove: { depth: 'through' as const }, hole: { diameter: 5, diameterExpression: 'dowel' } };
    const made = setCadVariable({ ...createCadDocument(), parts: [board, step] }, { name: 'dowel', expression: '8 mm' });
    if ('error' in made) throw new Error(made.error);
    expect(made.document.parts[1]!.hole!.diameter).toBe(8);
    expect(cadVariableUses(made.document, 'dowel')).toBe(1);
  });
});
