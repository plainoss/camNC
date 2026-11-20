import {
  cadDrawnOnSupports,
  effectivePlacement,
  evaluateCadDocument,
  faceRims,
  rimAt,
  rotateVector,
  type CadDocument,
  type CadFilletRim,
  type EvaluatedCadPart,
} from '@wbcnc/cad';
import type { CadConnectorPick } from './PartFeatureDialogs';

export type Picked = { partId: string; corner: string } | { partId: string; rim: CadFilletRim };

/** The design has an error elsewhere, so the part isn't built: its edges along its faces can't be found. */
export const kUnbuilt = 'The design can’t be built as it is, so edges along its faces can’t be picked: fix its errors first.';

export const pickKey = (pick: Picked) =>
  'corner' in pick
    ? pick.corner
    : `${pick.rim.face ? 'face' : 'edge'}:${pick.rim.side}:${pick.rim.loops.join(',')}:${pick.rim.lines?.join(',') ?? ''}`;

// A pick is read against the design the dialog opened on, built once.
const builtParts = new WeakMap<CadDocument, Map<string, EvaluatedCadPart>>();
function builtPart(document: CadDocument, partId: string): EvaluatedCadPart | undefined {
  let parts = builtParts.get(document);
  if (!parts) builtParts.set(document, (parts = new Map(evaluateCadDocument(document).parts.map(part => [part.partId, part]))));
  return parts.get(partId);
}

/**
 * What a click in the view picks: an edge through a part's thickness is the sketch corner where two of its sides meet;
 * an edge along its top or underside, or a pocket's floor, is the loop it runs along; and a click on its top or
 * underside picks every edge of that face, as both edges of a cup's rim.
 */
export function pickedOf(document: CadDocument, pick: CadConnectorPick, edgeByEdge = false): Picked | { error: string } {
  const part = document.parts.find(candidate => candidate.id === pick.partId);
  if (!part) return { error: 'Click an edge or a face of a part.' };
  if (pick.copy) return { error: 'Pick the edge on the part itself, not on a copy of it.' };
  const at = effectivePlacement(part, cadDrawnOnSupports(document)) ?? { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const back = [-at.rotation[0], -at.rotation[1], -at.rotation[2], at.rotation[3]];
  const local = (p: [number, number, number]) => rotateVector(back, [p[0] - at.position[0], p[1] - at.position[1], p[2] - at.position[2]]);
  const built = () => builtPart(document, part.id);
  if (!pick.edge) {
    const normal = rotateVector(back, pick.normal);
    const point = local(pick.surfacePoint ?? pick.point);
    const made = built();
    if (!made) return { error: kUnbuilt };
    if (Math.abs(normal[2]) < 1 - 1e-6) return { error: 'Click an edge, or the top or underside of a part.' };
    const side = normal[2] > 0 ? 'top' : 'underside';
    if (Math.abs(point[2] - (side === 'top' ? made.thickness : 0)) > 1e-3)
      return { error: 'A pocket’s floor meets its walls at inside edges, which can’t be rounded over: pick the edges to round.' };
    const rim = faceRims(made, side, { x: point[0], y: point[1] });
    return 'error' in rim ? rim : { partId: part.id, rim };
  }
  const a = local(pick.edge.a),
    b = local(pick.edge.b);
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-3) {
    const made = built();
    if (!made) return { error: kUnbuilt };
    const found = rimAt(made, a, b);
    if ('error' in found) return found;
    // Picked edge by edge, a straight edge is the stretch along its line of the sketch; a curve is its whole loop.
    const line = edgeByEdge ? lineAlong(part.sketch.entities, a, b) : undefined;
    return { partId: part.id, rim: { side: found.side, loops: [found.loopId], ...(line && { lines: [line] }) } };
  }
  const corner = part.sketch.entities.find(
    entity => entity.type === 'point' && !entity.construction && Math.hypot(entity.x - a[0], entity.y - a[1]) < 1e-3
  );
  return corner ? { partId: part.id, corner: corner.id } : { error: 'That edge isn’t at a corner of the part’s sketch.' };
}

/** The sketch line a straight edge of the part runs along, between its ends: its ID, or undefined for none. */
function lineAlong(entities: CadDocument['parts'][number]['sketch']['entities'], a: number[], b: number[]): string | undefined {
  const points = new Map(entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
  const m = { x: (a[0]! + b[0]!) / 2, y: (a[1]! + b[1]!) / 2 };
  for (const line of entities) {
    if (line.type !== 'line' || line.construction) continue;
    const p = points.get(line.startId),
      q = points.get(line.endId);
    if (!p || !q) continue;
    const dx = q.x - p.x,
      dy = q.y - p.y,
      length = Math.hypot(dx, dy);
    if (!length) continue;
    const off = (point: { x: number; y: number }) => Math.abs((point.x - p.x) * dy - (point.y - p.y) * dx) / length;
    const t = ((m.x - p.x) * dx + (m.y - p.y) * dy) / (length * length);
    if (t > 0 && t < 1 && off(m) < 1e-3 && off({ x: a[0]!, y: a[1]! }) < 1e-3 && off({ x: b[0]!, y: b[1]! }) < 1e-3) return line.id;
  }
  return undefined;
}
