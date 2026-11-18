import { expect, it } from 'vitest';
import {
  addRectangle,
  createCadDocument,
  createCadPart,
  evaluateCadPart,
  parseCadDocument,
  polygonArea,
  resolvePartPatterns,
} from './index';
import { cadDocumentVersion } from './documentVersion';
import type { CadDocument, CadPart } from './types';

const board = (): CadPart => {
  const part = { ...createCadPart('Part 1', 40), id: 'p1', drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 60 });
  return part;
};
const box = (points: { x: number; y: number }[]) => [
  Math.min(...points.map(p => p.x)),
  Math.min(...points.map(p => p.y)),
  Math.max(...points.map(p => p.x)),
  Math.max(...points.map(p => p.y)),
];

it('joins a part with its mirror image across the Right plane into one part twice as long', () => {
  const document: CadDocument = {
    ...createCadDocument(),
    version: 7,
    parts: [{ ...board(), mirrorJoins: [{ id: 'm1', across: { plane: 'right' } }] }],
  };
  const laid = resolvePartPatterns(document);
  expect(laid.parts[0]!.mirrorJoins![0]!.line).toEqual({ x: 0, y: 0, nx: 1, ny: 0 });
  const made = evaluateCadPart(laid.parts[0]!);
  expect(made.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  expect(box(made.part!.outline)).toEqual([-100, 0, 100, 60]);
  expect(Math.abs(polygonArea(made.part!.outline))).toBeCloseTo(12_000, 6);
  expect(made.part!.thickness).toBe(40);
  // Saved and read back, it needs a reader that knows it.
  expect(cadDocumentVersion(laid)).toBe(7);
  expect(parseCadDocument(JSON.parse(JSON.stringify(laid))).parts[0]!.mirrorJoins).toHaveLength(1);
});

it('leaves the part as it was, and says why, across a plane parallel to its sketch', () => {
  const part = { ...board(), mirrorJoins: [{ id: 'm1', across: { plane: 'top' as const } }] };
  const laid = resolvePartPatterns({ ...createCadDocument(), version: 7, parts: [part] });
  const made = evaluateCadPart(laid.parts[0]!);
  expect(box(made.part!.outline)).toEqual([0, 0, 100, 60]);
  expect(made.diagnostics.map(d => d.code)).toContain('mirror-unresolved');
});
