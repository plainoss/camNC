import { Matrix4, Vector3 } from 'three';
import { expect, it } from 'vitest';
import type { BodyMesh } from '../camTypes';
import { centerAssembled, explodeAssembled, interpolateExplosion } from './layoutFlat';

const body = (positions: number[]): BodyMesh => ({
  name: 'Part',
  partId: 'part',
  positions: new Float32Array(positions),
  indices: new Uint32Array(),
  flat: new Matrix4().toArray(),
});
const meshes = [body([100, 200, 300, 120, 240, 310]), body([120, 200, 300, 140, 240, 310])];

it.each(['centered', 'studio'] as const)('interpolates the %s assembly without moving the origin or rotating parts', kind => {
  const assembled = kind === 'studio' ? new Matrix4() : centerAssembled(meshes);
  const exploded = explodeAssembled(meshes, assembled);
  const start = interpolateExplosion(assembled, exploded, 0);
  const middle = interpolateExplosion(assembled, exploded, 0.5);
  const end = interpolateExplosion(assembled, exploded, 1);
  for (let i = 0; i < meshes.length; i++) {
    expect(start[i]!.elements).toEqual(assembled.elements);
    expect(end[i]!.elements).toEqual(exploded[i]!.elements);
    const at = (matrix: Matrix4) => new Vector3().setFromMatrixPosition(matrix);
    expect(at(middle[i]!).distanceTo(at(start[i]!).lerp(at(end[i]!), 0.5))).toBeLessThan(1e-10);
    expect(middle[i]!.clone().setPosition(0, 0, 0).elements).toEqual(new Matrix4().elements);
  }
  const endpointGap = new Vector3(120, 200, 300).applyMatrix4(end[1]!).x - new Vector3(120, 240, 310).applyMatrix4(end[0]!).x;
  expect(endpointGap).toBeGreaterThan(0);
});

it('keeps an empty model empty and a single studio part at its original position', () => {
  expect(interpolateExplosion(new Matrix4(), explodeAssembled([]), 0.5)).toEqual([]);
  const single = [body([0, 0, 0, 10, 10, 10])];
  expect(explodeAssembled(single, new Matrix4())[0]!.elements).toEqual(new Matrix4().elements);
});
