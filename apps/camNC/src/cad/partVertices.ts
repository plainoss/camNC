import { cornerKey } from '@wbcnc/cad';
import type { PartEdge } from './partEdges';
import { partEdgeSourceKey, type PartEdgeSource } from './partWorldEdges';

export interface PartVertex extends PartEdgeSource {
  key: string;
  x: number;
  y: number;
  onPlane: boolean;
  ambiguous?: boolean;
}

/** Selectable endpoints shared by the projected model edges. */
export function partVertices(edges: PartEdge[]) {
  const vertices = new Map<string, Map<string, PartVertex>>();
  for (const edge of edges)
    for (const [x, y] of [
      [edge.x1, edge.y1],
      [edge.x2, edge.y2],
    ] as const) {
      const key = `vertex:${cornerKey(x, y)}`;
      let sources = vertices.get(key);
      const eligible = sources?.values().next().value;
      if (eligible?.onPlane && !edge.onPlane) continue;
      if (!sources || (edge.onPlane && !eligible?.onPlane)) vertices.set(key, (sources = new Map()));
      const sourceKey = partEdgeSourceKey(edge),
        previous = sources.get(sourceKey);
      sources.set(sourceKey, {
        key,
        partId: edge.partId,
        ...(edge.copyId && { copyId: edge.copyId }),
        x,
        y,
        onPlane: edge.onPlane,
        ambiguous: edge.ambiguous || previous?.ambiguous,
      });
    }
  return [...vertices.entries()].map(([key, sources]) => ({
    ...sources.values().next().value!,
    key: JSON.stringify([key, ...[...sources.keys()].sort()]),
    ...(sources.size > 1 && { ambiguous: true }),
  }));
}
