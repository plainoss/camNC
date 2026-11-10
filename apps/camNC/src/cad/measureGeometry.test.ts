import { describe, expect, it } from 'vitest';
import { measureEntities, type MeasureEntity, type MeasureTriangle, type MeasureVec3 } from './measureGeometry';

const vertex = (point: MeasureVec3): MeasureEntity => ({ kind: 'vertex', point });
const edge = (a: MeasureVec3, b: MeasureVec3): MeasureEntity => ({ kind: 'edge', a, b });
const face = (triangles: MeasureTriangle[], normal: MeasureVec3 = [0, 0, 1]): MeasureEntity => ({ kind: 'face', triangles, normal });
const rectangle = (x: number, y: number, width: number, height: number, z = 0): MeasureEntity =>
  face([
    [
      [x, y, z],
      [x + width, y, z],
      [x + width, y + height, z],
    ],
    [
      [x, y, z],
      [x + width, y + height, z],
      [x, y + height, z],
    ],
  ]);
const row = (entities: MeasureEntity[], id: string) => {
  const result = measureEntities(entities);
  expect(result.problem).toBeUndefined();
  const found = result.rows.find(candidate => candidate.id === id);
  expect(found, id).toBeDefined();
  return found!;
};

describe('finite assembled geometry measurements', () => {
  it('measures a 3–4–5 vertex distance and signed XYZ components with axis witnesses', () => {
    const entities = [vertex([10, 20, 30]), vertex([13, 16, 30])];
    expect(row(entities, 'distance')).toMatchObject({ value: 5, witness: { a: [10, 20, 30], b: [13, 16, 30] } });
    expect(['x', 'y', 'z'].map(axis => row(entities, `delta-${axis}`).value)).toEqual([3, -4, 0]);
    expect(row(entities, 'delta-x').witness).toEqual({ a: [10, 20, 30], b: [13, 20, 30] });
    expect(row(entities, 'delta-y').witness).toEqual({ a: [10, 20, 30], b: [10, 16, 30] });
    expect(row([entities[0]!], 'position-z').value).toBe(30);
  });

  it('uses finite segment endpoints rather than infinite supporting lines', () => {
    const entities = [edge([0, 0, 0], [10, 0, 0]), edge([15, 3, 0], [20, 3, 0])];
    expect(row(entities, 'min-distance').value).toBeCloseTo(Math.sqrt(34), 12);
    expect(row(entities, 'min-distance').witness).toEqual({ a: [10, 0, 0], b: [15, 3, 0] });
    expect(row(entities, 'max-distance').value).toBeCloseTo(Math.sqrt(409), 12);
    expect(row(entities, 'center-distance').value).toBeCloseTo(Math.hypot(12.5, 3), 12);
    expect(row(entities, 'length').value).toBe(15);
    expect(measureEntities(entities).parallel).toBe(true);
    expect(row(entities, 'angle').value).toBe(0);
  });

  it('measures skew segments at their interior closest points', () => {
    const entities = [edge([-10, 0, 0], [10, 0, 0]), edge([0, -10, 5], [0, 10, 5])];
    expect(row(entities, 'min-distance')).toMatchObject({ value: 5, witness: { a: [0, 0, 0], b: [0, 0, 5] } });
    expect(row(entities, 'angle').value).toBe(90);
    expect(measureEntities(entities).parallel).toBe(false);
  });

  it('retains a real intersection for long almost-parallel finite segments', () => {
    const a = edge([-1e9, 0, 0], [1e9, 0, 0]),
      b = edge([-1e9, 1, 0], [1e9, -1, 0]);
    expect(row([a, b], 'min-distance').value).toBe(0);
    expect(row([a, b], 'min-distance').witness).toEqual({ a: [0, 0, 0], b: [0, 0, 0] });
    expect(measureEntities([a, b]).parallel).toBe(false);
  });

  it('retains an interior projection on a long skinny triangle', () => {
    const triangle = face([
      [
        [0, 0, 0],
        [1e9, 1, 0],
        [1e9, -1, 0],
      ],
    ]);
    expect(row([vertex([5e8, 0, 7]), triangle], 'min-distance')).toMatchObject({
      value: 7,
      witness: { a: [5e8, 0, 7], b: [5e8, 0, 0] },
    });
  });

  it('uses an endpoint-order independent acute angle for straight edges', () => {
    const a = edge([0, 0, 0], [10, 0, 0]);
    const forward = edge([0, 0, 1], [5, 5 * Math.sqrt(3), 1]);
    const reversed = edge([5, 5 * Math.sqrt(3), 1], [0, 0, 1]);
    expect(row([a, forward], 'angle').value).toBeCloseTo(60, 12);
    expect(row([a, reversed], 'angle').value).toBeCloseTo(60, 12);
  });

  it('measures point-to-face and edge-to-face interior distances', () => {
    const square = rectangle(0, 0, 20, 20);
    expect(row([vertex([10, 10, 7]), square], 'min-distance')).toMatchObject({ value: 7, witness: { a: [10, 10, 7], b: [10, 10, 0] } });
    const crossing = edge([10, 10, -5], [10, 10, 5]);
    expect(row([crossing, square], 'min-distance').value).toBeCloseTo(0, 12);
    const above = edge([5, 10, 3], [15, 10, 3]);
    expect(row([above, square], 'min-distance').value).toBeCloseTo(3, 12);
    expect(row([vertex([10, 10, 1e-10]), square], 'min-distance').value).toBe(1e-10);
  });

  it('finds intersecting triangle interiors when no vertices or boundary edges coincide', () => {
    const horizontal = face([
      [
        [-10, -10, 0],
        [10, -10, 0],
        [0, 10, 0],
      ],
    ]);
    const vertical = face(
      [
        [
          [0, 0, -5],
          [0, 0, 5],
          [0, 5, 5],
        ],
      ],
      [1, 0, 0]
    );
    const result = row([horizontal, vertical], 'min-distance');
    expect(result.value).toBeCloseTo(0, 12);
    expect(result.witness!.a).toEqual(result.witness!.b);
    expect(row([horizontal, vertical], 'angle').value).toBe(90);
  });

  it('measures separate finite parallel faces rather than only their plane spacing', () => {
    const entities = [rectangle(0, 0, 10, 10), rectangle(13, 14, 2, 2, 12)];
    expect(row(entities, 'min-distance').value).toBe(13);
    expect(row(entities, 'min-distance').witness).toEqual({ a: [10, 10, 0], b: [13, 14, 12] });
    expect(row(entities, 'max-distance').value).toBeCloseTo(Math.hypot(15, 16, 12), 12);
    expect(row(entities, 'area').value).toBe(104);
  });

  it('preserves holes and area-weighted centers in a planar face', () => {
    // Four strips form a 10×10 face with a 2×2 central hole. No triangles fill the hole.
    const strips = [rectangle(0, 0, 10, 4), rectangle(0, 6, 10, 4), rectangle(0, 4, 4, 2), rectangle(6, 4, 4, 2)];
    const holed = face(strips.flatMap(part => (part.kind === 'face' ? part.triangles : [])));
    expect(row([holed], 'area').value).toBe(96);
    expect(row([vertex([5, 5, 0]), holed], 'min-distance').value).toBe(1);
    expect(row([holed], 'position-x').value).toBe(5);
    expect(row([holed], 'position-y').value).toBe(5);
    // An L face's centroid differs from its bounding-box center.
    const lShape = face([rectangle(0, 0, 6, 2), rectangle(0, 2, 2, 4)].flatMap(part => (part.kind === 'face' ? part.triangles : [])));
    expect(row([lShape], 'area').value).toBe(20);
    expect(row([lShape], 'position-x').value).toBeCloseTo(2.2, 12);
    expect(row([lShape], 'position-y').value).toBeCloseTo(2.2, 12);
  });

  it('measures opposite stock faces by their oriented normals and finite occupied areas', () => {
    const bottom = rectangle(0, 0, 100, 50),
      top = rectangle(0, 0, 100, 50, 18);
    if (bottom.kind === 'face') bottom.normal = [0, 0, -1];
    expect(row([bottom, top], 'min-distance').value).toBe(18);
    expect(row([bottom, top], 'angle').value).toBe(180);
    expect(row([bottom, top], 'area').value).toBe(10000);
  });

  it('retains measurements under a rigid rotation, reflection and translation', () => {
    const original = [edge([0, 0, 0], [10, 0, 0]), rectangle(13, 4, 2, 2, 12)];
    // Reflect X, rotate quarter-turn around Y, then translate. This exchanges world X/Z and changes handedness.
    const transform = ([x, y, z]: MeasureVec3): MeasureVec3 => [z + 100, y - 20, x + 30];
    const mapped = original.map(
      (entity): MeasureEntity =>
        entity.kind === 'edge'
          ? edge(transform(entity.a), transform(entity.b))
          : entity.kind === 'face'
            ? face(
                entity.triangles.map(triangle => triangle.map(transform) as MeasureTriangle),
                [1, 0, 0]
              )
            : vertex(transform(entity.point))
    );
    for (const id of ['length', 'area', 'min-distance', 'max-distance', 'center-distance'])
      expect(row(mapped, id).value).toBeCloseTo(row(original, id).value, 10);
    const witness = row(mapped, 'min-distance').witness!;
    const before = row(original, 'min-distance').witness!;
    expect(witness.a).toEqual(transform(before.a));
    expect(witness.b).toEqual(transform(before.b));
  });

  it('sums mixed selected lengths and areas without inventing a distance between more than two entities', () => {
    const result = measureEntities([edge([0, 0, 0], [3, 4, 0]), edge([0, 0, 1], [0, 0, 13]), rectangle(0, 0, 2, 3)]);
    expect(result.rows.find(candidate => candidate.id === 'length')?.value).toBe(17);
    expect(result.rows.find(candidate => candidate.id === 'area')?.value).toBe(6);
    expect(result.rows.some(candidate => candidate.id.includes('distance'))).toBe(false);
  });

  it('measures tessellated cabinet faces without depending on triangle order or interior mesh vertices', () => {
    const grid = (z: number) =>
      face(
        Array.from({ length: 32 * 32 }, (_, index) => {
          const x = (index % 32) * 31.25,
            y = Math.floor(index / 32) * 15.625;
          const cell = rectangle(x, y, 31.25, 15.625, z);
          return cell.kind === 'face' ? cell.triangles : [];
        }).flat()
      );
    const bottom = grid(0),
      top = grid(18),
      entities = [bottom, top];
    const result = measureEntities(entities);
    expect(result.problem).toBeUndefined();
    expect(result.rows.find(candidate => candidate.id === 'min-distance')).toMatchObject({
      value: 18,
      witness: { a: [0, 0, 0], b: [0, 0, 18] },
    });
    expect(result.rows.find(candidate => candidate.id === 'max-distance')!.value).toBeCloseTo(Math.hypot(1000, 500, 18), 10);
    expect(result.rows.find(candidate => candidate.id === 'area')!.value).toBe(1e6);
    if (top.kind === 'face') top.triangles.reverse();
    expect(measureEntities(entities).rows.find(candidate => candidate.id === 'min-distance')).toEqual(
      result.rows.find(candidate => candidate.id === 'min-distance')
    );
  });

  it('handles zero-length edges without NaNs and refuses invalid or area-less faces', () => {
    const pointEdge = edge([1, 2, 3], [1, 2, 3]);
    expect(row([pointEdge, vertex([4, 6, 3])], 'min-distance').value).toBe(5);
    expect(measureEntities([pointEdge, edge([0, 0, 0], [1, 0, 0])]).rows.some(candidate => candidate.id === 'angle')).toBe(false);
    expect(measureEntities([])).toEqual({ rows: [] });
    for (const entity of [
      vertex([0, Infinity, 0]),
      face([]),
      face([
        [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
        ],
      ]),
      face(
        [
          [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
        ],
        [0, 0, 0]
      ),
    ]) {
      const result = measureEntities([entity]);
      expect(result.rows).toEqual([]);
      expect(result.problem).toBeTruthy();
    }
  });
});
