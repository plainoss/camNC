import { expect, it } from 'vitest';
import {
  addCircle,
  addRectangle,
  cadPartsToCut,
  consumedTools,
  createCadDocument,
  createCadPart,
  designSteps,
  parseCadDocument,
  polygonArea,
  sketchRegions,
  solveCadDocument,
  type CadDocument,
  type CadPart,
} from './index';

const board = (): CadPart => {
  const part = { ...createCadPart('Part 1', 10), id: 'board', drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 40 });
  return { ...part, regions: sketchRegions(part.sketch).map(region => region.id) };
};
const disc = (inward: boolean): CadPart => {
  const part = {
    ...createCadPart('Part 2', 10),
    id: 'disc',
    drawnOn: { on: { plane: 'top' as const }, offset: 0, ...(inward && { inward: true }) },
  };
  part.sketch = addCircle(part.sketch, { x: 0, y: 0, radius: 30 });
  return { ...part, regions: sketchRegions(part.sketch).map(region => region.id), intersect: true };
};
const design = (inward: boolean): CadDocument => ({ ...createCadDocument(), version: 7, parts: [board(), disc(inward)] });

it('keeps only what the extrude shares with the part it runs into: a quarter disc over the board', async () => {
  const solved = await solveCadDocument(design(false));
  const parts = cadPartsToCut(solved.document, solved.parts);
  expect(parts.map(entry => entry.part.name)).toEqual(['Part 1']);
  expect(Math.abs(polygonArea(parts[0]!.part.outline))).toBeCloseTo((Math.PI * 900) / 4, -1);
  expect(designSteps(solved.document).every(step => !step.broken)).toBe(true);
});

it('changes nothing but its own body when the extrude goes the other way and only touches the board, and says so', async () => {
  const document = design(true);
  expect(consumedTools(document)).toEqual(new Set(['disc']));
  const solved = await solveCadDocument(document);
  // The board is cut as it was, whole.
  const parts = cadPartsToCut(solved.document, solved.parts);
  expect(parts.map(entry => [entry.part.name, Math.abs(polygonArea(entry.part.outline))])).toEqual([['Part 1', 4000]]);
  expect(designSteps(document).find(step => step.id === 'disc:extrude')?.broken).toBe(
    'The parts either do not intersect or are totally contained.'
  );
});

it('reads only well-formed Intersect, Merge with all, taken-edge and pattern-grid settings', () => {
  const saved = (change: (part: Record<string, unknown>) => void) => {
    const document = JSON.parse(JSON.stringify(design(false)));
    change(document.parts[1]);
    return () => parseCadDocument(document);
  };
  expect(saved(() => {})).not.toThrow();
  expect(saved(part => (part.intersect = 'yes'))).toThrow();
  expect(saved(part => (part.mergeAll = false))).toThrow();
  expect(saved(part => ((part.sketch as { entities: Record<string, unknown>[] }).entities[0]!.taken = true))).toThrow();
  // A grid a variable made larger than a pattern can lay out still opens; it lays out what fits.
  expect(
    saved(part => (part.pattern = { id: 'p', axis: 'x', count: 200, spacing: 10, second: { vector: [0, 1, 0], count: 200, spacing: 10 } }))
  ).not.toThrow();
});
