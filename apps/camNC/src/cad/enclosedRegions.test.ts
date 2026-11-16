import {
  addCircle,
  addRectangle,
  createCadDocument,
  createCadPart,
  regionInteriorPoint,
  sketchRegions,
  type CadDocument,
} from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { enclosedUsedRegions } from './enclosedRegions';

it('takes the rest of a circle an earlier extrude used along with the circle’s free part, and nothing before that', () => {
  const board = { ...createCadPart('Part 1', 10), id: 'board' };
  board.sketch = addCircle(addRectangle(board.sketch, { x: 0, y: 0, width: 100, height: 40 }), { x: 0, y: 0, radius: 30 });
  const regions = sketchRegions(board.sketch);
  const at = (x: number, y: number) =>
    regions.find(region => {
      const p = regionInteriorPoint(region.points)!;
      return Math.sign(p.x - 0) === Math.sign(x) && Math.sign(p.y) === Math.sign(y) && (x > 0 ? (p.x < 30 && p.y < 30) === x < 30 : true);
    })!.id;
  const overlap = at(10, 10),
    rest = at(60, 30),
    free = at(-15, -15);
  const add = { ...createCadPart('Part 2', 20), id: 'add', sketch: board.sketch, sketchOf: 'board', regions: [] as string[] };
  // Nothing used yet: a pick is only itself.
  expect(enclosedUsedRegions({ ...createCadDocument(), parts: [{ ...board, regions: [] }, add] } as CadDocument, add, free)).toEqual([]);
  const document = { ...createCadDocument(), parts: [{ ...board, regions: [rest, overlap] }, add] } as CadDocument;
  expect(enclosedUsedRegions(document, add, free)).toEqual([overlap]);
  // The rectangle's own region isn't in the circle.
  expect(enclosedUsedRegions(document, add, rest)).toEqual([]);
});
