import { expect, it } from 'vitest';
import {
  addRectangle,
  cadPartsToCut,
  consumedTools,
  createCadDocument,
  createCadPart,
  solveCadDocument,
  parseCadDocument,
  polygonArea,
  type CadDocument,
  type CadPart,
  type EvaluatedCadPart,
} from './index';

const board = (name: string, width: number, height: number, thickness: number, offset = 0): CadPart => {
  const part = { ...createCadPart(name, thickness), id: name, drawnOn: { on: { plane: 'top' as const }, offset } };
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width, height });
  return part;
};
const volume = (part: EvaluatedCadPart) =>
  Math.abs(polygonArea(part.outline)) * part.thickness -
  (part.cuts ?? []).reduce((sum, cut) => sum + Math.abs(polygonArea(cut.outline)) * (cut.to - cut.from), 0);
const union = (parts: CadPart[], keep = false): CadDocument => ({
  ...createCadDocument(),
  version: 7,
  parts,
  partCuts: [
    {
      id: 'b1',
      operation: 'union',
      targets: [parts[0]!.id],
      tools: parts.slice(1).map(p => p.id),
      clearance: 0,
      ...(!keep && { consumeTools: true as const }),
    },
  ],
});

it('joins two boards drawn on one plane into the first, as high as the higher and stepped down where only the lower was', async () => {
  const document = union([board('Part 1', 100, 40, 10), board('Part 2', 40, 80, 30)]);
  const solved = await solveCadDocument(document);
  const parts = cadPartsToCut(solved.document, solved.parts);
  expect(parts.map(entry => entry.part.name)).toEqual(['Part 1']);
  const [joined] = parts;
  expect(joined!.part.thickness).toBe(30);
  expect(volume(joined!.part)).toBeCloseTo(120_000, 3);
  expect(consumedTools(document)).toEqual(new Set(['Part 2']));
  // Saved and loaded, it's a Boolean step that needs a reader that knows it.
  expect(parseCadDocument(JSON.parse(JSON.stringify(document))).partCuts![0]!.operation).toBe('union');
  expect(() => parseCadDocument(JSON.parse(JSON.stringify({ ...document, version: 6 })))).toThrow();
});

it('keeps the tools as parts when asked, and refuses boards on different planes', async () => {
  const kept = await solveCadDocument(union([board('Part 1', 100, 40, 10), board('Part 2', 40, 80, 30)], true));
  expect(cadPartsToCut(kept.document, kept.parts).map(entry => [entry.part.name, entry.part.thickness])).toEqual([
    ['Part 1', 30],
    ['Part 2', 30],
  ]);
  const apart = await solveCadDocument(union([board('Part 1', 100, 40, 10), board('Part 2', 40, 80, 30, 5)]));
  expect(apart.diagnostics.some(d => d.code === 'boolean-unresolved')).toBe(true);
});
