import { addRectangle, createCadDocument, createCadPart, type CadDocument, type CadPart } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { nativeCadModel } from './nativeCadModel';

/** A 100 × 40 × 10 block, its top front edge (along +X at y = 0) chamfered `distance` by a Chamfer step. */
function chamferedBlock(distance: number, edges: 'front' | 'all' = 'front'): CadDocument {
  const part: CadPart = { ...createCadPart('Part 1', 10), id: 'block' };
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 40 });
  const points = new Map(part.sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
  const front = part.sketch.entities.find(
    e => e.type === 'line' && points.get(e.startId)!.y === 0 && points.get(e.endId)!.y === 0 && !e.construction
  )!;
  part.fillets = [
    {
      id: 'chamfer',
      corners: [],
      rims: [{ side: 'top', loops: ['outline'], ...(edges === 'front' && { lines: [front.id] }) }],
      radius: distance,
      chamfer: true,
    },
  ];
  return { ...createCadDocument(), parts: [part] };
}

function measure(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  let volume = 0,
    area = 0;
  const box = [0, 1, 2].map(() => [Infinity, -Infinity]);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map(k => [0, 1, 2].map(axis => positions[indices[t + k]! * 3 + axis]!)) as [number[], number[], number[]];
    volume += a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
    const u = [0, 1, 2].map(i => b[i]! - a[i]!),
      v = [0, 1, 2].map(i => c[i]! - a[i]!);
    area += Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
    for (const p of [a, b, c])
      for (const axis of [0, 1, 2]) box[axis] = [Math.min(box[axis]![0]!, p[axis]!), Math.max(box[axis]![1]!, p[axis]!)];
  }
  return { volume: Math.abs(volume / 6), area, box };
}

it('cuts a 3 × 3 chamfer along one top edge of a block, and leaves the others sharp', async () => {
  const { model } = await nativeCadModel(chamferedBlock(3));
  const mesh = model.meshes[0]!;
  const { volume, area, box } = measure(mesh.positions, mesh.indices);
  expect(volume).toBeCloseTo(40000 - 4.5 * 100, 3);
  // The face and front lose a 3 mm strip each, the slope adds 3√2 × 100, and each end loses a 3 × 3 triangle.
  expect(area).toBeCloseTo(10800 - 600 + 3 * Math.SQRT2 * 100 - 2 * 4.5, 3);
  expect(box).toEqual([
    [0, 100],
    [0, 40],
    [0, 10],
  ]);
});

it('chamfers a whole loop when no edge is named, and doesn’t mill it as a roundover', async () => {
  const { model, entries } = await nativeCadModel(chamferedBlock(2, 'all'));
  const mesh = model.meshes[0]!;
  // Four 2 × 2 strips, mitered at the corners: 100 × 40 × 10 less the frustum's skin.
  const { volume } = measure(mesh.positions, mesh.indices);
  expect(volume).toBeCloseTo(40000 - 2 * (2 * 100 + 2 * 40) + (4 * 2 * 2 * 2) / 3, 1);
  expect([...entries.values()][0]!.features.rounds).toBeUndefined();
});
