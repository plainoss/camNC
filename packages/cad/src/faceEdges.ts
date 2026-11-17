import { constraintEntityIds, entityPointIds } from './document';
import { drawnOnOutline } from './drawnOn';
import { faceSupportPart } from './faceSupport';
import { evaluateCadPart } from './geometry';
import type { CadDocument, CadEntity, CadPart, CadPointEntity, CadSketch } from './types';

/** Geometry kept where the edges of the face a part is drawn on are: drawing onto it ties the part to that face. */
export const isFaceEdge = (entity: CadEntity | undefined): boolean => !!entity?.faceEdge;

const faceEdgeId = (sketch: CadSketch, key: string) => `${sketch.id}:face:${key}`;

/** The edges a part's sketch sees of the face it's drawn on: its outline's lines, or an edge face's four sides. */
function wantedFaceEdges(document: CadDocument, part: CadPart): CadEntity[] {
  const on = part.drawnOn?.on;
  if (!on || 'plane' in on) return [];
  const source = document.parts.find(candidate => candidate.id === on.partId);
  if (!source) return [];
  const copy = on.copyId ? source.copies?.find(copy => copy.id === on.copyId) : undefined;
  if (on.copyId && !copy) return [];
  const support = faceSupportPart(source, copy);
  const sketch = part.sketch;
  const point = (key: string, x: number, y: number): CadPointEntity => ({
    id: faceEdgeId(sketch, key),
    type: 'point',
    x: x === 0 ? 0 : x,
    y,
    fixed: true,
    construction: true,
    faceEdge: true,
  });
  const line = (key: string, start: string, end: string): CadEntity => ({
    id: faceEdgeId(sketch, key),
    type: 'line',
    startId: faceEdgeId(sketch, start),
    endId: faceEdgeId(sketch, end),
    construction: true,
    faceEdge: true,
  });
  if ((on.face === 'top' || on.face === 'underside') && support.thin) {
    // A thin board's faces are its flat outline, not its edge-on sketch.
    const outline = evaluateCadPart(support).part?.outline;
    if (!outline) return [];
    const flip = on.face === 'underside' ? -1 : 1;
    return [
      ...outline.map((p, i) => point(`corner${i}`, p.x * flip, p.y)),
      ...outline.map((_, i) => line(`side${i}`, `corner${i}`, `corner${(i + 1) % outline.length}`)),
    ];
  }
  if (on.face === 'top' || on.face === 'underside') {
    // The support's own lines, as this sketch sees them: the top as drawn, the underside from below.
    const flip = on.face === 'underside' ? -1 : 1;
    const points = new Map(support.sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
    const lines = support.sketch.entities.filter(
      (e): e is Extract<CadEntity, { type: 'line' }> => e.type === 'line' && !e.construction && !e.owner && !e.faceEdge
    );
    // Lines that meet at a corner each have their own end there, held together: one point stands for them all.
    const corners = new Map<string, string>();
    const cornerOf = (id: string) => {
      const p = points.get(id)!;
      const key = `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
      if (!corners.has(key)) corners.set(key, id);
      return corners.get(key)!;
    };
    const drawn = lines.filter(e => points.has(e.startId) && points.has(e.endId));
    const ends = drawn.map(e => [cornerOf(e.startId), cornerOf(e.endId)] as const);
    // Its circles too, each with its centre: a round part's edge is one to use and dimension to.
    const circles = support.sketch.entities.filter(
      (e): e is Extract<CadEntity, { type: 'circle' }> => e.type === 'circle' && !e.construction && !e.faceEdge && points.has(e.centerId)
    );
    return [
      ...[...corners.values()].map(id => point(id, points.get(id)!.x * flip, points.get(id)!.y)),
      ...drawn.flatMap((e, i) => (ends[i]![0] === ends[i]![1] ? [] : [line(e.id, ...ends[i]!)])),
      ...circles.flatMap(e => [
        point(`${e.id}:center`, points.get(e.centerId)!.x * flip, points.get(e.centerId)!.y),
        {
          id: faceEdgeId(sketch, e.id),
          type: 'circle' as const,
          centerId: faceEdgeId(sketch, `${e.id}:center`),
          radius: e.radius,
          construction: true,
          faceEdge: true,
        },
      ]),
    ];
  }
  const outline = drawnOnOutline(document, part);
  if (!outline) return [];
  return [
    ...outline.map((p, i) => point(`corner${i}`, p.x, p.y)),
    ...outline.map((_, i) => line(`side${i}`, `corner${i}`, `corner${(i + 1) % outline.length}`)),
  ];
}

/**
 * A part's sketch with the edges of the face it's drawn on where that face now is, as fixed construction geometry. What
 * is tied to them follows the face. An edge that's gone stays where it was, as plain fixed construction, while anything
 * is still tied to it, so nothing drawn moves; otherwise it goes.
 */
export function withFaceEdges(document: CadDocument, part: CadPart): CadSketch {
  const sketch = part.sketch;
  // Solved on its own, as a dimension is checked, the face isn't in the document: its edges stay as they are.
  const on = part.drawnOn?.on;
  if (on && 'partId' in on && !document.parts.some(candidate => candidate.id === on.partId)) return sketch;
  const wanted = new Map(wantedFaceEdges(document, part).map(e => [e.id, e]));
  if (!wanted.size && !sketch.entities.some(isFaceEdge)) return sketch;
  // What the drawing itself uses: its relations, and its own curves' points.
  const used = new Set([
    ...sketch.constraints.flatMap(constraintEntityIds),
    ...sketch.entities.filter(e => !isFaceEdge(e)).flatMap(entityPointIds),
  ]);
  for (const e of sketch.entities) if (isFaceEdge(e) && !wanted.has(e.id) && used.has(e.id)) entityPointIds(e).forEach(id => used.add(id));
  let changed = false;
  const entities: CadEntity[] = [];
  for (const e of sketch.entities) {
    if (!isFaceEdge(e)) {
      entities.push(e);
      continue;
    }
    const next = wanted.get(e.id);
    wanted.delete(e.id);
    if (next) {
      // An edge taken in with Use stays in the drawing as the face moves.
      const kept = e.taken ? { ...next, construction: false, taken: true as const } : next;
      if (JSON.stringify(kept) !== JSON.stringify(e)) changed = true;
      entities.push(kept);
    } else {
      changed = true;
      if (!used.has(e.id)) continue;
      const kept = { ...e };
      delete kept.faceEdge;
      entities.push(kept);
    }
  }
  // An edge whose ID something of the drawing's own already has, say a piece split off it, isn't put back.
  for (const id of wanted.keys()) if (entities.some(e => e.id === id)) wanted.delete(id);
  if (wanted.size) changed = true;
  entities.push(...wanted.values());
  return changed ? { ...sketch, entities } : sketch;
}
