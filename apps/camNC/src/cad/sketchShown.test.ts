import {
  addRectangle,
  createCadDocument,
  createCadPart,
  parseCadDocument,
  resolveDrawnPlacements,
  type CadDocument,
  type CadPart,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { featureShownByDefault } from './sketchShown';
import { sketchLinesInModel } from './sketchLines';

/** A 200×120 board extruded 20 mm on Top, with an 80×50 sketch on its top face used by a second Extrude. */
function design(operation: Partial<CadPart>): CadDocument {
  const board: CadPart = { ...createCadPart('Part 1', 20), id: 'board', drawnOn: { on: { plane: 'top' }, offset: 0 } };
  board.sketch = addRectangle(board.sketch, { x: 0, y: 0, width: 200, height: 120 });
  const face: CadPart = {
    ...createCadPart('Part 2', 10),
    id: 'face',
    drawnOn: { on: { partId: board.id, face: 'top' }, offset: 0 },
    ...operation,
  };
  face.sketch = addRectangle(face.sketch, { x: 60, y: 35, width: 80, height: 50 });
  return resolveDrawnPlacements({ ...createCadDocument(), parts: [board, face] }).document;
}

describe('a sketch used by an Extrude', () => {
  const cases: [string, Partial<CadPart>][] = [
    ['New', {}],
    ['Add', { addTo: 'board' }],
    ['Remove', { remove: { depth: 'through' } }],
  ];
  it.each(cases)('hides by default when the Extrude on a face sketch is %s, also after saving and reloading', (_, operation) => {
    const document = design(operation);
    const reloaded = parseCadDocument(JSON.parse(JSON.stringify(document)));
    for (const shown of [document, reloaded]) {
      expect(featureShownByDefault(shown, 'face:sketch')).toBe(false);
      expect(featureShownByDefault(shown, 'board:sketch')).toBe(false);
      expect(sketchLinesInModel(shown)).toEqual([]);
    }
  });

  it('shows while not extruded yet, and while its Extrude is suppressed', () => {
    expect(featureShownByDefault(design({ extrude: false }), 'face:sketch')).toBe(true);
    expect(featureShownByDefault(design({ remove: { depth: 'through' }, suppressed: true }), 'face:sketch')).toBe(true);
    expect(featureShownByDefault(design({}), 'origin')).toBe(true);
  });
});
