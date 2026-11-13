import { addLine, addRectangle, CAD_CHORD_TOLERANCE, createCadDocument, createCadPart, sketchRegions, type CadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { withRegionToggled } from './extrudeRegionViews';
import { startExtrude } from './studioExtrude';
import { unpickedExtrudePreview, withoutUnpickedProblem } from './unpickedExtrude';

function sketched(): CadDocument {
  const sketch = { ...createCadPart('Part 1', 18), drawnOn: { on: { plane: 'top' as const }, offset: 0 }, extrude: false as const };
  sketch.sketch = addRectangle(sketch.sketch, { x: 0, y: 0, width: 100, height: 50 });
  return { ...createCadDocument(), parts: [sketch] };
}

const started = (document: CadDocument, pickAll = false) => {
  const result = startExtrude(document, { part: document.parts[0]! }, pickAll, part => part);
  if ('refusal' in result) throw new Error(result.refusal);
  return result;
};

it('starts a sketch’s first extrude with no region picked, even when the sketch is one outline', () => {
  const { document, partId } = started(sketched());
  const part = document.parts.find(p => p.id === partId)!;
  expect(part.extrude).toBeUndefined();
  expect(part.regions).toEqual([]);
  // Asked for all of it, as from its row or the open sketch, it starts whole.
  expect(started(sketched(), true).document.parts[0]!.regions).toBeUndefined();
});

it('picks the only region and unpicks it back to none, not to the whole sketch', () => {
  const { document, partId } = started(sketched());
  const [region] = sketchRegions(document.parts[0]!.sketch, CAD_CHORD_TOLERANCE);
  const picked = withRegionToggled(document, partId, region!.id);
  expect(picked.parts[0]!.regions).toEqual([region!.id]);
  expect(withRegionToggled(picked, partId, region!.id).parts[0]!.regions).toEqual([]);
});

it('shows an open extrude with nothing picked as its sketch alone, and without a problem', () => {
  const { document, partId } = started(sketched());
  expect(unpickedExtrudePreview(document, partId).parts[0]!.extrude).toBe(false);
  expect(unpickedExtrudePreview(document, null)).toBe(document);
  const problem = { partId, code: 'region-count', severity: 'error', message: 'Pick the regions of the sketch to extrude in the view.' };
  const result = { document, diagnostics: [problem], status: 'invalid' } as unknown as Parameters<typeof withoutUnpickedProblem>[0];
  expect(withoutUnpickedProblem(result, partId)).toMatchObject({ diagnostics: [], status: 'solved' });
  // Once a region is picked, it is the part it makes again.
  const [region] = sketchRegions(document.parts[0]!.sketch, CAD_CHORD_TOLERANCE);
  const picked = withRegionToggled(document, partId, region!.id);
  expect(unpickedExtrudePreview(picked, partId)).toBe(picked);
});

it('keeps showing an open extrude with nothing picked that still builds, as a thin board', () => {
  const board = { ...createCadPart('Part 1', 18), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  board.sketch = addLine(board.sketch, { x1: 0, y1: 0, x2: 60, y2: 0 });
  const thin = { ...createCadDocument(), parts: [{ ...board, regions: [], thin: { depth: 10, midPlane: true } }] };
  expect(unpickedExtrudePreview(thin, board.id)).toBe(thin);
});
