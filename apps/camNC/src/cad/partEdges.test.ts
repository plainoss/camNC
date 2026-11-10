import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BodyMesh } from '@/cam/camTypes';
import { partEdgesOnPlane } from './partEdges';
import { partVertices } from './partVertices';

/** A 100 × 50 × 20 board with its lower corner at the origin. */
function board(partId: string): BodyMesh {
  const box = new THREE.BoxGeometry(100, 50, 20).translate(50, 25, 10);
  const positions = box.getAttribute('position').array as Float32Array;
  return { name: partId, partId, positions, indices: new Uint32Array(box.getIndex()!.array), flat: [] };
}

const top = {
  origin: [0, 0, 0] as [number, number, number],
  x: [1, 0, 0] as [number, number, number],
  y: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
};

describe('the edges of the parts behind a sketch', () => {
  it('lays each edge onto the plane once, and says which lie in it', () => {
    const edges = partEdgesOnPlane([board('a')], top);
    // The board's outline from above: its four sides, the upright edges seen end-on left out.
    expect(edges).toHaveLength(4);
    expect(edges.every(edge => edge.onPlane)).toBe(true);
    expect(edges.map(edge => Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1)).sort((a, b) => a - b)).toEqual([50, 50, 100, 100]);
  });

  it('marks edges seen through the plane as not in it', () => {
    const edges = partEdgesOnPlane([board('a')], { ...top, origin: [0, 0, -5] });
    expect(edges).toHaveLength(4);
    expect(edges.some(edge => edge.onPlane)).toBe(false);
  });

  it('retains exact copy identity through projection without confusing a seed and its moved copy', () => {
    const copy = board('family');
    for (let at = 0; at < copy.positions.length; at += 3) copy.positions[at]! += 200;
    const edges = partEdgesOnPlane([board('family'), copy], top, [{ partId: 'family' }, { partId: 'family', copyId: 'copy' }]);
    expect(edges).toHaveLength(8);
    expect(edges.filter(edge => edge.copyId === 'copy')).toHaveLength(4);
    expect(edges.filter(edge => edge.copyId === 'copy').every(edge => Math.min(edge.x1, edge.x2) >= 200)).toBe(true);
    expect(edges.every(edge => !edge.ambiguous)).toBe(true);
  });

  it('refuses to assign coincident projected segments to an arbitrary physical owner', () => {
    const edges = partEdgesOnPlane([board('a'), board('b')], top);
    expect(edges).toHaveLength(4);
    expect(edges.every(edge => edge.ambiguous)).toBe(true);
    expect(partVertices(edges).every(vertex => vertex.ambiguous)).toBe(true);
    // The top and underside of one ordinary board are one owner's projection, not an ambiguity.
    expect(partEdgesOnPlane([board('a')], top).every(edge => !edge.ambiguous)).toBe(true);
  });

  it.each([false, true])('keeps a unique in-plane owner ahead of off-plane projections (reverse: %s)', reverse => {
    const outside = board('outside');
    for (let at = 2; at < outside.positions.length; at += 3) outside.positions[at]! += 50;
    const meshes = [outside, board('inside')];
    const edges = partEdgesOnPlane(reverse ? meshes.reverse() : meshes, top);
    expect(edges).toHaveLength(4);
    expect(edges.every(edge => edge.partId === 'inside' && edge.onPlane && !edge.ambiguous)).toBe(true);
  });

  it('marks a shared vertex ambiguous while keeping the incident nonoverlapping edges owned', () => {
    const edges = [
      { key: 'a', partId: 'a', x1: 0, y1: 0, x2: 10, y2: 0, onPlane: true },
      { key: 'b', partId: 'b', copyId: 'copy', x1: 10, y1: 0, x2: 10, y2: 20, onPlane: true },
    ];
    const vertices = partVertices(edges);
    expect(vertices.find(vertex => vertex.x === 10 && vertex.y === 0)?.ambiguous).toBe(true);
    expect(vertices.find(vertex => vertex.x === 10 && vertex.y === 20)).toMatchObject({ partId: 'b', copyId: 'copy' });
  });

  it.each([false, true])('keeps the unique in-plane source of a shared vertex (reverse: %s)', reverse => {
    const edges = [
      { key: 'a', partId: 'a', x1: 0, y1: 0, x2: 10, y2: 0, onPlane: true },
      { key: 'b', partId: 'b', x1: 0, y1: 0, x2: 0, y2: 20, onPlane: false },
    ];
    const vertex = partVertices(reverse ? edges.reverse() : edges).find(vertex => vertex.x === 0 && vertex.y === 0)!;
    expect(vertex.partId).toBe('a');
    expect(vertex.ambiguous).toBeFalsy();
  });
});
