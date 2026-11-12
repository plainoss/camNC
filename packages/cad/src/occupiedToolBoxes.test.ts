import { expect, it } from 'vitest';
import { occupiedToolBoxes } from './occupiedToolBoxes';
import { createPlateDocument, evaluateCadDocument, type CadPoint, type EvaluatedCadPart } from './index';

const rectangle = (x: number, y: number, width: number, height: number): CadPoint[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];
const stock = () => evaluateCadDocument(createPlateDocument({ width: 100, height: 60, thickness: 18 })).parts[0]!;
function volume(shape: EvaluatedCadPart, lo: [number, number, number] = [0, 0, 0], hi: [number, number, number] = [100, 60, 18]) {
  const result = occupiedToolBoxes(shape, lo, hi);
  if ('refused' in result) throw Error(result.refused);
  return result.boxes.reduce((sum, [a, b]) => sum + (b[0] - a[0]) * (b[1] - a[1]) * (b[2] - a[2]), 0);
}

it('decomposes concave occupied material without filling the absent corner', () => {
  const shape = {
    ...stock(),
    outline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 80, y: 40 },
      { x: 80, y: 60 },
      { x: 0, y: 60 },
    ],
  };
  expect(volume(shape)).toBe((100 * 60 - 20 * 20) * 18);
});

it('preserves through holes, pocket floors and islands, with union semantics for overlapping cuts', () => {
  const shape = stock();
  shape.holes = [rectangle(10, 10, 10, 10)];
  const pocket = {
    id: 'pocket',
    regionId: 'pocket',
    side: 'top' as const,
    from: 0,
    to: 9,
    through: false,
    outline: rectangle(40, 20, 20, 20),
    islands: [rectangle(45, 25, 10, 10)],
  };
  shape.cuts = [pocket, { ...pocket, id: 'overlapping-pocket' }];
  expect(volume(shape)).toBe(100 * 60 * 18 - 10 * 10 * 18 - (20 * 20 - 10 * 10) * 9);
  expect(volume(shape, [45, 25, 0], [55, 35, 18])).toBe(10 * 10 * 18);
  expect(volume(shape, [40, 20, 0], [45, 25, 18])).toBe(5 * 5 * 9);
  expect(volume(shape, [10, 10, 0], [20, 20, 18])).toBe(0);
});

it.each([1, 0.0001])('refuses every intersecting diagonal void boundary, including a small %s mm one', size => {
  const shape = stock();
  shape.holes = [
    [
      { x: 10, y: 10 + size },
      { x: 10 + size, y: 10 },
      { x: 10 + 2 * size, y: 10 + size },
      { x: 10 + size, y: 10 + 2 * size },
    ],
  ];
  expect(occupiedToolBoxes(shape, [0, 0, 0], [100, 60, 18])).toHaveProperty('refused');
  // Its remote material is still eligible; the unsupported boundary cannot intersect this reach.
  expect(volume(shape, [80, 0, 0], [100, 60, 18])).toBe(20 * 60 * 18);
});

it('refuses an oblique pocket or island instead of treating a partly occupied cell as stock', () => {
  const shape = stock();
  shape.cuts = [
    {
      id: 'slanted',
      regionId: 'slanted',
      side: 'top',
      from: 0,
      to: 5,
      through: false,
      outline: rectangle(10, 10, 20, 20),
      islands: [
        [
          { x: 15, y: 15 },
          { x: 25, y: 15 },
          { x: 20, y: 25 },
        ],
      ],
    },
  ];
  expect(occupiedToolBoxes(shape, [0, 0, 0], [100, 60, 18])).toHaveProperty('refused');
  expect(volume(shape, [0, 0, 0], [100, 60, 10])).toBe(100 * 60 * 10);
});
