import { addLine, addPoint, cadCornerSources, cornerKey, type CadSketch, type CadDocument, type cadSketchFrame } from '@wbcnc/cad';
import type { PartEdge } from './partEdges';
import { partVertices } from './partVertices';

/** Copy picked model vertices and edges into the sketch and keep their endpoints tied to source corners. */
export function addUsedPartEdges(
  sketch: CadSketch,
  partEdges: PartEdge[],
  keys: string[],
  source: CadDocument,
  frame: ReturnType<typeof cadSketchFrame> | undefined,
  partId?: string
) {
  let next = sketch;
  for (const edge of partEdges.filter(candidate => keys.includes(candidate.key)))
    next = addLine(next, { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2 });
  for (const vertex of partVertices(partEdges).filter(candidate => keys.includes(candidate.key)))
    next = addPoint(next, { x: vertex.x, y: vertex.y, fixed: true });
  const before = new Set(sketch.entities.map(entity => entity.id));
  const added = next.entities.filter(entity => !before.has(entity.id) && entity.type === 'line');
  const vertices = next.entities.filter(entity => !before.has(entity.id) && entity.type === 'point' && entity.standalone);
  const ends = new Set([
    ...added.flatMap(line => (line.type === 'line' ? [line.startId, line.endId] : [])),
    ...vertices.map(point => point.id),
  ]);
  // Each end at a corner of a part behind the sketch is tied to it, so the used edge follows that part, as in the reference.
  const corners = frame ? cadCornerSources(source, frame, partId) : new Map();
  return {
    sketch: {
      ...next,
      entities: next.entities.map(entity => {
        if (entity.type !== 'point' || !ends.has(entity.id)) return entity;
        const used = corners.get(cornerKey(entity.x, entity.y));
        return { ...entity, fixed: true, ...(used && { used }) };
      }),
    },
    selected: [...added, ...vertices].map(entity => entity.id),
  };
}
