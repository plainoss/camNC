import {
  addRectangle,
  createCadDocument,
  createCadPart,
  designSteps,
  evaluateCadFeatures,
  evaluateCadPart,
  resolveExtrudeSteps,
  setPartPattern,
  sketchRegions,
  type CadDocument,
} from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { splitPartWith } from './splitPart';
import { prepareStudioPreview } from './useStudioPreview';

/** Three 100 × 60 × 40 boards: one on Top, turned copies about its vertical edge at (100, 0). */
function boards(): CadDocument {
  const part = { ...createCadPart('Part 1', 40), id: 'p', drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 60 });
  const document = resolveExtrudeSteps({
    ...createCadDocument(),
    parts: [{ ...part, regions: sketchRegions(part.sketch).map(r => r.id) }],
  });
  const circular = {
    origin: [100, 0, 20] as [number, number, number],
    axis: [0, 0, -1] as [number, number, number],
    angle: 360,
    equalSpacing: true,
  };
  return prepareStudioPreview(setPartPattern(document, 'p', { axis: 'z', count: 3, spacing: 100, circular }));
}

const area = (points: { x: number; y: number }[]) =>
  Math.abs(points.reduce((sum, a, i) => sum + a.x * points[(i + 1) % points.length]!.y - points[(i + 1) % points.length]!.x * a.y, 0)) / 2;

/** A part's face as it's cut: a Split part keeps only its side of the plane. */
const face = (document: CadDocument, name: string) => {
  const part = document.parts.find(candidate => candidate.name === name)!;
  return area(evaluateCadFeatures(part, evaluateCadPart(part).part!).part.outline);
};

it('splits the copy the Front plane runs through into two parts, listed as Split 1, leaving the other boards whole', () => {
  const document = boards();
  const [crossed, beside] = document.parts[0]!.copies!;
  const made = splitPartWith(document, `p:${crossed!.id}`, { across: { plane: 'front' } }, 'split');
  if ('error' in made) throw new Error(made.error);
  expect(designSteps(made.document).map(step => step.label)).toEqual(['Sketch 1', 'Extrude 1', 'Circular pattern 1', 'Split 1']);
  // Part 1 and its other copy, the split copy, and the side split off it.
  const parts = made.document.parts;
  expect(parts.map(part => part.name)).toEqual(['Part 1', 'Part 1 2', 'Part 2']);
  expect(parts[0]!.copies).toHaveLength(1);
  expect(face(made.document, 'Part 1')).toBeCloseTo(6000, 3);
  const halves = face(made.document, 'Part 1 2') + face(made.document, 'Part 2');
  expect(halves).toBeCloseTo(6000, 3);
  expect(face(made.document, 'Part 2')).toBeGreaterThan(0);
  expect(face(made.document, 'Part 2')).toBeLessThan(6000);
  // The copy that only touches the plane at a corner isn't cut.
  expect(splitPartWith(document, `p:${beside!.id}`, { across: { plane: 'front' } }, 'split')).toEqual({
    error: 'The plane doesn’t cut through the part.',
  });
});

it('refuses a plane lying along the board, and a part whose copies would all follow it', () => {
  const document = boards();
  const copy = document.parts[0]!.copies![0]!;
  expect(splitPartWith(document, `p:${copy.id}`, { across: { plane: 'top' } }, 'split')).toMatchObject({
    error: expect.stringMatching(/stands across/),
  });
  expect(splitPartWith(document, 'p', { across: { plane: 'front' } }, 'split')).toMatchObject({ error: expect.stringMatching(/copies/) });
});
