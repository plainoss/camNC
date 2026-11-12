import { addLine, addPoint, cornerKey, type CadSketch, type CadDocument, type cadSketchFrame, type CadPointEntity } from '@wbcnc/cad';
import type { PartEdge } from './partEdges';
import { partVertices } from './partVertices';
import { partEdgeSourceKey, type PartEdgeSource } from './partWorldEdges';
import { physicalCornerSources as cadCornerSources } from './studioGeometryReaders';

interface UsedPartEdges {
  sketch: CadSketch;
  selected: string[];
  problem?: string;
}
type Corner = NonNullable<CadPointEntity['used']>;

/** Copy picked model geometry only when every endpoint can stay tied to the chosen physical source. */
export function addUsedPartEdges(
  sketch: CadSketch,
  partEdges: PartEdge[],
  keys: string[],
  source: CadDocument,
  frame: ReturnType<typeof cadSketchFrame> | undefined,
  partId?: string
): UsedPartEdges {
  const refuse = (problem: string): UsedPartEdges => ({ sketch, selected: [], problem });
  const corners = new Map<string, Map<string, Corner>>();
  const corner = (owner: PartEdgeSource, x: number, y: number) => {
    const key = partEdgeSourceKey(owner);
    if (!corners.has(key)) corners.set(key, frame ? cadCornerSources(source, frame, partId, owner) : new Map());
    return corners.get(key)!.get(cornerKey(x, y));
  };
  const choices = [
    ...partEdges.filter(edge => keys.includes(edge.key)).map(edge => ({ ...edge, type: 'edge' as const })),
    ...partVertices(partEdges)
      .filter(vertex => keys.includes(vertex.key))
      .map(vertex => ({ ...vertex, type: 'vertex' as const })),
  ];
  if (!choices.length) return refuse('Use: pick an available model edge or vertex.');
  let next = sketch;
  const selected: string[] = [];
  for (const choice of choices) {
    if (choice.ambiguous)
      return refuse('Use: this projection has more than one possible part or copy source. Hide an overlapping part, then pick again.');
    const points =
      choice.type === 'edge'
        ? [
            [choice.x1, choice.y1],
            [choice.x2, choice.y2],
          ]
        : [[choice.x, choice.y]];
    const references = points.map(([x, y]) => corner(choice, x!, y!));
    if (references.some(reference => !reference)) return refuse('Use: this geometry cannot be linked to its source corners yet.');
    // Imported references own their endpoints. Reusing a target point could steal another source's association,
    // or leave an origin-bound endpoint fixed while the chosen source moves.
    const empty = { ...sketch, entities: [], constraints: [] };
    const copied = choice.type === 'edge' ? addLine(empty, choice) : addPoint(empty, { x: choice.x, y: choice.y, fixed: true });
    let at = 0;
    const entities = copied.entities.map(entity =>
      entity.type === 'point' ? { ...entity, fixed: true, used: references[at++]! } : entity
    );
    next = { ...next, entities: [...next.entities, ...entities] };
    selected.push(...entities.filter(entity => entity.type !== 'point' || entity.standalone).map(entity => entity.id));
  }
  return { sketch: next, selected };
}
