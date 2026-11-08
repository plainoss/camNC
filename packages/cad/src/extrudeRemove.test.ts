import { describe, expect, it } from 'vitest';
import { addLine, addRectangle, createCadDocument, createCadPart, createPlateDocument } from './document';
import { cadCuts, cadFaceSketches } from './featureModel';
import { evaluateCadDocument } from './features';
import { extrudeRemove } from './extrudeRemove';
import type { CadDocument } from './types';

function design(
  draw: (sketch: ReturnType<typeof createCadPart>['sketch']) => ReturnType<typeof createCadPart>['sketch'],
  face: 'top' | 'underside' = 'top'
) {
  const board = { ...createPlateDocument({ width: 200, height: 100, thickness: 18 }).parts[0]!, id: 'board', name: 'Board' };
  const pocket = { ...createCadPart('Pocket', 18), drawnOn: { on: { partId: board.id, face }, offset: 0 } };
  pocket.sketch = draw(pocket.sketch);
  return { ...createCadDocument(), parts: [board, pocket] } as CadDocument;
}

describe('Extrude → Remove', () => {
  it('cuts a shape drawn on a board’s top into it, rather than making a part', () => {
    const source = design(sketch => addRectangle(sketch, { x: 50, y: 30, width: 40, height: 20 }));
    const result = extrudeRemove(source, source.parts[1]!.id, 6);
    if ('error' in result) throw new Error(result.error);
    const { document } = result;
    expect(document.parts.map(part => part.name)).toEqual(['Board']);
    const board = document.parts[0]!;
    expect(cadFaceSketches(board).map(face => face.on)).toEqual(['top']);
    expect(cadCuts(board).map(cut => cut.depth)).toEqual([6]);
    expect(evaluateCadDocument(document).parts[0]!.cuts).toHaveLength(1);
  });

  it('cuts a notch drawn against the edge, leaving the rest of the board', () => {
    const source = design(sketch => {
      let next = addLine(sketch, { x1: 0, y1: 40, x2: 30, y2: 40 });
      next = addLine(next, { x1: 30, y1: 40, x2: 30, y2: 60 });
      return addLine(next, { x1: 30, y1: 60, x2: 0, y2: 60 });
    });
    const result = extrudeRemove(source, source.parts[1]!.id, 'through');
    if ('error' in result) throw new Error(result.error);
    expect(cadCuts(result.document.parts[0]!).map(cut => cut.depth)).toEqual(['through']);
  });

  it('keeps a depth typed with variables, and refuses what it can’t cut', () => {
    const source = design(sketch => addRectangle(sketch, { x: 50, y: 30, width: 40, height: 20 }));
    const withVariables = { ...source, variables: [{ id: 'v', name: 'pocket', expression: '5 mm' }] };
    const result = extrudeRemove(withVariables, source.parts[1]!.id, 5, 'pocket');
    if ('error' in result) throw new Error(result.error);
    expect(cadCuts(result.document.parts[0]!)[0]).toMatchObject({ depth: 5, depthExpression: 'pocket' });

    expect(extrudeRemove(source, source.parts[1]!.id, 0)).toHaveProperty('error');
    expect(
      extrudeRemove(
        design(sketch => addLine(sketch, { x1: 50, y1: 30, x2: 90, y2: 30 })),
        'missing',
        5
      )
    ).toHaveProperty('error');
    const open = design(sketch => addLine(sketch, { x1: 50, y1: 30, x2: 90, y2: 30 }));
    expect(extrudeRemove(open, open.parts[1]!.id, 5)).toEqual({ error: 'Draw a closed shape on the face to cut it out.' });
  });
});
