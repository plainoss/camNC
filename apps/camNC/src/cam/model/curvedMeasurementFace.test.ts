import { describe, expect, it } from 'vitest';
import { measurementEntityAt } from './measurementPick';
import { measureEntities, type MeasureEntity } from '@/cad/measureGeometry';

const kDiameter = 36.905,
  kHeight = 25,
  kSegments = 64;

/** A 120 × 80 × 18 board with a ⌀36.905 cylinder 25 high standing on its top, tessellated as the studio draws it. */
function cylinderOnBoard() {
  const points: number[] = [],
    indices: number[] = [];
  const vertex = (x: number, y: number, z: number) => (points.push(x, y, z), points.length / 3 - 1);
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, a, c, d);
  // Board: bottom and the four sides; its top is a fan around the cylinder's foot.
  const corners = [
    [0, 0],
    [120, 0],
    [120, 80],
    [0, 80],
  ].map(([x, y]) => [vertex(x!, y!, 0), vertex(x!, y!, 18)] as const);
  quad(corners[0]![0], corners[3]![0], corners[2]![0], corners[1]![0]);
  for (let i = 0; i < 4; i++) {
    const [a0, a1] = corners[i]!,
      [b0, b1] = corners[(i + 1) % 4]!;
    quad(a0, b0, b1, a1);
  }
  const r = kDiameter / 2,
    foot: number[] = [],
    rim: number[] = [];
  for (let i = 0; i < kSegments; i++) {
    const angle = (i / kSegments) * Math.PI * 2,
      x = 60 + r * Math.cos(angle),
      y = 40 + r * Math.sin(angle);
    foot.push(vertex(x, y, 18));
    rim.push(vertex(x, y, 18 + kHeight));
  }
  const sideStart = indices.length / 3;
  for (let i = 0; i < kSegments; i++) quad(foot[i]!, foot[(i + 1) % kSegments]!, rim[(i + 1) % kSegments]!, rim[i]!);
  const topStart = indices.length / 3,
    center = vertex(60, 40, 18 + kHeight);
  for (let i = 0; i < kSegments; i++) indices.push(center, rim[i]!, rim[(i + 1) % kSegments]!);
  // The board's top around the foot: each foot segment joined to its nearest board corner, plus the corner fills.
  const boardTop = indices.length / 3;
  const quadrant = (i: number) => Math.floor(((i + 0.5) / kSegments) * 4);
  for (let i = 0; i < kSegments; i++) indices.push(corners[(quadrant(i) + 2) % 4]![1], foot[(i + 1) % kSegments]!, foot[i]!);
  for (let q = 0; q < 4; q++) indices.push(corners[(q + 1) % 4]![1], corners[(q + 2) % 4]![1], foot[(q * kSegments) / 4]!);
  return { positions: new Float32Array(points), indices: new Uint32Array(indices), sideStart, topStart, boardTop };
}

const far = { point: () => 100, segment: () => 100 };
const label = (entities: MeasureEntity[]) =>
  Object.fromEntries(measureEntities(entities).rows.map(row => [row.label, Number(row.value.toFixed(3))]));

describe('round faces', () => {
  const mesh = cylinderOnBoard();
  const at = (triangle: number, screen = far) => measurementEntityAt(mesh.positions, mesh.indices, triangle, screen)!;

  it('picks the whole cylinder wall as one face with its diameter, not one facet or its seam', () => {
    // A click right on a seam between two facets: with flat facets it measured the seam, the wall's height.
    const side = at(mesh.sideStart + 10, { point: () => 100, segment: () => 0 });
    expect(side.kind).toBe('face');
    if (side.kind !== 'face') return;
    expect(side.triangles).toHaveLength(kSegments * 2);
    expect(side.cylinder!.radius * 2).toBeCloseTo(kDiameter, 3);
    const rows = label([side]);
    expect(rows.Diameter).toBeCloseTo(kDiameter, 3);
    expect(rows.Area).toBeCloseTo(Math.PI * kDiameter * kHeight, 1);
    expect(rows).not.toHaveProperty('Length');
    expect(measureEntities([side]).rows[0]!.label).toBe('Diameter');
    // Another facet of the same wall is the same face, so clicking it again takes it off the selection.
    expect(JSON.stringify(at(mesh.sideStart + 70))).toBe(JSON.stringify(side));
  });

  it('measures the cylinder top as the true disc', () => {
    const top = at(mesh.topStart + 3);
    expect(top.kind === 'face' && top.cylinder).toBeFalsy();
    expect(label([top]).Area).toBeCloseTo((Math.PI * kDiameter ** 2) / 4, 3);
    // The board's top has the cylinder's foot as a round hole.
    expect(label([at(mesh.boardTop + 5)]).Area).toBeCloseTo(120 * 80 - (Math.PI * kDiameter ** 2) / 4, 2);
  });

  it('gives the angle between the wall’s axis and the top as perpendicular', () => {
    const rows = label([at(mesh.sideStart), at(mesh.topStart)]);
    expect(rows['Perp axes angle']).toBeCloseTo(90, 6);
  });

  it('keeps a box face flat', () => {
    const face = at(0);
    expect(face.kind === 'face' && face.cylinder).toBeFalsy();
    expect(label([face]).Area).toBeCloseTo(120 * 80, 3);
  });
});
