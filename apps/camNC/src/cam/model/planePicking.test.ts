import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { kPlaneMarker, planeGivesWay } from './planePicking';

describe('picking through a plane', () => {
  const plane = new THREE.Mesh();
  plane.userData = kPlaneMarker;
  const outline = new THREE.LineSegments();
  plane.add(outline);
  const face = new THREE.Mesh();

  it('gives way to a part’s face behind it, but not to another plane or its own outline', () => {
    expect(planeGivesWay([{ object: plane }, { object: face }])).toBe(true);
    expect(planeGivesWay([{ object: plane }, { object: outline }, { object: plane.clone() }])).toBe(false);
    expect(planeGivesWay([{ object: plane }])).toBe(false);
  });
});
