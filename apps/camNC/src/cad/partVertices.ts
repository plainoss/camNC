import { cornerKey } from '@wbcnc/cad';
import type { PartEdge } from './partEdges';

/** Selectable endpoints shared by the projected model edges. */
export function partVertices(edges: PartEdge[]) {
  const vertices = new Map<string, { key: string; x: number; y: number }>();
  for (const edge of edges)
    for (const [x, y] of [
      [edge.x1, edge.y1],
      [edge.x2, edge.y2],
    ] as const) {
      const key = `vertex:${cornerKey(x, y)}`;
      if (!vertices.has(key)) vertices.set(key, { key, x, y });
    }
  return [...vertices.values()];
}
