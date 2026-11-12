import { addPoint, createCadDocument, createCadPart, createPlateDocument, type CadDocument, type CadPart } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { holeSource } from './holeSource';

const board = (): CadPart => ({ ...createPlateDocument({ width: 100, height: 60 }).parts[0]!, name: 'Board' });
const points = (name: string, on: { partId: string; copyId?: string; face: 'top' | 'underside' | { edge: string } }): CadPart => {
  const sketch = { ...createCadPart(name, 18), drawnOn: { on, offset: 0 }, extrude: false as const };
  sketch.sketch = addPoint(sketch.sketch, { x: 20, y: 30 });
  return sketch;
};
const design = (...parts: CadPart[]): CadDocument => ({ ...createCadDocument(), parts });

describe('holeSource', () => {
  it('drills a board with the newest sketch with points on its top or underside', () => {
    const b = board();
    const older = points('Older', { partId: b.id, face: 'top' });
    const newer = points('Newer', { partId: b.id, face: 'underside' });
    expect(holeSource(design(b, older, newer), { partId: b.id })).toEqual({ partId: newer.id, convert: true });
    expect(holeSource(design(b, older), { partId: b.id })).toEqual({ partId: older.id, convert: true });
  });

  it('skips sketches on a copy’s face or an edge face, and sketches without points', () => {
    const b = board();
    const onCopy = points('On copy', { partId: b.id, copyId: 'copy', face: 'top' });
    const onEdge = points('On edge', { partId: b.id, face: { edge: 'e1' } });
    const empty = { ...points('Empty', { partId: b.id, face: 'top' }), sketch: createCadPart('Empty', 18).sketch };
    expect(holeSource(design(b, onCopy, onEdge, empty), { partId: b.id })).toEqual({
      refusal: 'Hole drills at the points of a sketch on Board. Sketch points on its top or underside, then choose Hole.',
    });
  });

  it('skips a suppressed sketch, and says so when it is the only one', () => {
    const b = board();
    const used = points('Used', { partId: b.id, face: 'top' });
    const off = { ...points('Off', { partId: b.id, face: 'top' }), suppressed: true as const };
    expect(holeSource(design(b, used, off), { partId: b.id })).toEqual({ partId: used.id, convert: true });
    expect(holeSource(design(b, off), { partId: b.id })).toEqual({
      refusal: 'The points sketch on Board, Off, is suppressed. Unsuppress it, then choose Hole.',
    });
  });

  it('leaves out sketches below the rollback bar', () => {
    const b = board();
    const above = points('Above', { partId: b.id, face: 'top' });
    const below = points('Below', { partId: b.id, face: 'top' });
    const document = design(b, above, below);
    expect(holeSource(document, { partId: b.id, rolledTo: `${above.id}:sketch` })).toEqual({ partId: above.id, convert: true });
    expect(holeSource(document, { partId: b.id, rolledTo: `${b.id}:extrude` })).toMatchObject({ refusal: expect.any(String) });
  });

  it('refuses Remove and Add steps, a copy, and no selection', () => {
    const b = board();
    const remove = { ...board(), id: 'remove', remove: { depth: 'through' as const } };
    const add = { ...board(), id: 'add', addTo: b.id };
    const document = design(b, remove, add);
    const refusal = 'Hole drills into a board. Select the board, or a sketch with points on its face.';
    expect(holeSource(document, { partId: remove.id })).toEqual({ refusal });
    expect(holeSource(document, { partId: add.id })).toEqual({ refusal });
    expect(holeSource(document, { partId: b.id, copyId: 'copy' })).toEqual({
      refusal: 'Drilling only the selected copy is not supported. Select the source part in Parts to drill its whole family.',
    });
    expect(holeSource(document, {})).toEqual({ refusal: 'Select a board, or a sketch with points on its face, then choose Hole.' });
  });

  it('makes a selected sketch the hole, and opens a Hole step again', () => {
    const b = board();
    const sketch = points('Points', { partId: b.id, face: 'top' });
    const hole = { ...points('Hole', { partId: b.id, face: 'top' }), hole: { diameter: 5 }, remove: { depth: 'through' as const } };
    const document = design(b, sketch, hole);
    expect(holeSource(document, { partId: sketch.id })).toEqual({ partId: sketch.id, convert: true });
    expect(holeSource(document, { partId: hole.id })).toEqual({ partId: hole.id, convert: false });
  });
});
