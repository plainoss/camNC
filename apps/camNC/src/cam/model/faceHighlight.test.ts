import { expect, it } from 'vitest';
import { faceHighlightGeometry, sameFacePlane } from './faceHighlight';

it('highlights just the selected plane and keeps gaps where the solid has no triangles', () => {
  const mesh = {
    positions: Float32Array.from([
      0, 0, 1, 1, 0, 1, 0, 1, 1, 2, 0, 1, 3, 0, 1, 2, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    ]),
    indices: Uint32Array.from({ length: 12 }, (_, i) => i),
  };
  const face = { point: [0, 0, 1] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
  const geometry = faceHighlightGeometry(mesh, face);
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(Array.from(mesh.positions.slice(0, 18)));
  expect(sameFacePlane(face, { point: [20, 50, 1], normal: [0, 0, 1] })).toBe(true);
  expect(sameFacePlane(face, { point: [0, 0, 0], normal: [0, 0, 1] })).toBe(false);
  expect(sameFacePlane(face, { point: [0, 0, 1], normal: [0, 0, -1] })).toBe(false);
  geometry.dispose();
});
