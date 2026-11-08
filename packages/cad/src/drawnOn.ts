import { evaluateCadPart, pointInPolygon } from './geometry';
import { CAD_IDENTITY_PLACEMENT, placePoint, rotateVector, type Vec3 } from './placement';
import type { CadDiagnostic, CadDocument, CadDrawnOn, CadPart, CadPlacement, CadPoint, EvaluatedCadPart } from './types';

/** A face as a frame: where its sketch's origin is, and which ways its x, y and outward normal point. */
interface Frame {
  origin: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
  /** An edge face's length along its x. */
  length?: number;
}

const kPlanes: Record<'top' | 'front' | 'right', Frame> = {
  top: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  front: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] },
  right: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0] },
};
const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
const tidy = (value: number) => {
  const rounded = Math.round(value * 1e9) / 1e9;
  return rounded === 0 ? 0 : rounded;
};

/** The unit quaternion that turns the standard axes onto a frame's. */
function rotationOf({ x, y, z }: Frame): [number, number, number, number] {
  const trace = x[0] + y[1] + z[2];
  let q: [number, number, number, number];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  } else if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    q = [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  } else if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    q = [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  } else {
    const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
    q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
  }
  const length = Math.hypot(...q);
  return q.map(value => tidy(value / length)) as [number, number, number, number];
}

/** A frame given in a part's own coordinates, carried into the assembly with the part's placement. */
const carried = (placement: CadPlacement, frame: Frame): Frame => ({
  origin: placePoint(placement, frame.origin),
  x: rotateVector(placement.rotation, frame.x),
  y: rotateVector(placement.rotation, frame.y),
  z: rotateVector(placement.rotation, frame.z),
});

/**
 * One face of a part, in its own coordinates. The top looks up; the underside is seen from below, so its x runs the
 * other way. An edge face runs along an outline line, its x along the line (counterclockwise round the part), its y up
 * the part's thickness and its normal outwards.
 */
function partFace(part: CadPart, evaluated: EvaluatedCadPart, face: Extract<CadDrawnOn['on'], { partId: string }>['face']): Frame | string {
  if (face === 'top') return { origin: [0, 0, part.thickness], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  if (face === 'underside') return { origin: [0, 0, 0], x: [-1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] };
  const line = part.sketch.entities.find(entity => entity.id === face.edge);
  if (line?.type !== 'line') return 'The edge it was drawn on is gone.';
  const point = (id: string) => part.sketch.entities.find(entity => entity.id === id) as CadPoint | undefined;
  let a = point(line.startId),
    b = point(line.endId);
  if (!a || !b) return 'The edge it was drawn on is gone.';
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  let d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  // Outward is to the right of a counterclockwise walk. If that's inside, walk the line the other way.
  if (pointInPolygon({ x: (a.x + b.x) / 2 + d.y * 0.01, y: (a.y + b.y) / 2 - d.x * 0.01 }, evaluated.outline)) {
    [a, b] = [b, a];
    d = { x: -d.x, y: -d.y };
  }
  return { origin: [a.x, a.y, 0], x: [d.x, d.y, 0], y: [0, 0, 1], z: [d.y, -d.x, 0], length };
}

/**
 * The placement of every part drawn on a plane or another part's face, worked out from that face as the parts are now,
 * so a part follows the one it's drawn on. Parts are placed in the order they depend on each other.
 */
export function resolveDrawnPlacements(
  document: CadDocument,
  evaluated: readonly EvaluatedCadPart[] = []
): { document: CadDocument; diagnostics: CadDiagnostic[] } {
  if (!document.parts.some(part => part.drawnOn)) return { document, diagnostics: [] };
  const diagnostics: CadDiagnostic[] = [];
  const byId = new Map(document.parts.map(part => [part.id, part]));
  const shapes = new Map(evaluated.map(part => [part.partId, part]));
  const placed = new Map<string, CadPlacement | undefined>();
  const visiting = new Set<string>();
  const place = (part: CadPart): CadPlacement | undefined => {
    if (placed.has(part.id)) return placed.get(part.id);
    if (!part.drawnOn) {
      placed.set(part.id, part.placement);
      return part.placement;
    }
    const problem = (message: string) => {
      diagnostics.push({ code: 'drawn-on-unresolved', severity: 'warning', partId: part.id, message: `${part.name}: ${message}` });
      placed.set(part.id, part.placement);
      return part.placement;
    };
    if (visiting.has(part.id)) return problem('It’s drawn on a part that is drawn on it.');
    visiting.add(part.id);
    const { on, offset, inward } = part.drawnOn;
    let frame: Frame;
    if ('plane' in on) frame = kPlanes[on.plane];
    else {
      const support = byId.get(on.partId);
      if (!support) return problem('The part it was drawn on is gone.');
      const supportPlacement = place(support) ?? CAD_IDENTITY_PLACEMENT;
      const shape = shapes.get(support.id) ?? evaluateCadPart(support).part;
      if (!shape) return problem(`${support.name} can’t be worked out, so neither can where this goes.`);
      const face = partFace(support, shape, on.face);
      if (typeof face === 'string') return problem(face);
      frame = carried(supportPlacement, face);
    }
    visiting.delete(part.id);
    const along = offset - (inward ? part.thickness : 0);
    const placement: CadPlacement = {
      position: add(frame.origin, frame.z, along).map(tidy) as Vec3,
      rotation: rotationOf(frame),
    };
    placed.set(part.id, placement);
    return placement;
  };
  const parts = document.parts.map(part => {
    if (!part.drawnOn) return part;
    const placement = place(part);
    return placement && JSON.stringify(placement) !== JSON.stringify(part.placement) ? { ...part, placement } : part;
  });
  return { document: parts.every((part, i) => part === document.parts[i]) ? document : { ...document, parts }, diagnostics };
}

/**
 * Where a face of one part sits in another part's sketch: the face's outline as that sketch sees it, for drawing a
 * part on it. Only the faces a part can be drawn on have one.
 */
export function drawnOnOutline(document: CadDocument, part: CadPart): CadPoint[] | null {
  const on = part.drawnOn?.on;
  if (!on || 'plane' in on) return null;
  const support = document.parts.find(candidate => candidate.id === on.partId);
  const shape = support && evaluateCadPart(support).part;
  if (!support || !shape) return null;
  if (on.face === 'top') return shape.outline;
  if (on.face === 'underside') return shape.outline.map(p => ({ x: -p.x, y: p.y })).reverse();
  const face = partFace(support, shape, on.face);
  if (typeof face === 'string') return null;
  return [
    { x: 0, y: 0 },
    { x: face.length!, y: 0 },
    { x: face.length!, y: support.thickness },
    { x: 0, y: support.thickness },
  ];
}

/**
 * Which face of a part a click landed on, from where it hit and which way the face looks, both in the assembly. A
 * face a part can be drawn on is its top, its underside, or the edge face along one of its outline's lines.
 */
export function partFaceAt(
  part: CadPart,
  placement: CadPlacement,
  point: Vec3,
  normal: Vec3
): Extract<CadDrawnOn['on'], { partId: string }>['face'] | null {
  const back = [-placement.rotation[0], -placement.rotation[1], -placement.rotation[2], placement.rotation[3]];
  const local = rotateVector(back, [point[0] - placement.position[0], point[1] - placement.position[1], point[2] - placement.position[2]]);
  const facing = rotateVector(back, normal);
  if (facing[2] > 0.99) return 'top';
  if (facing[2] < -0.99) return 'underside';
  if (Math.abs(facing[2]) > 0.01) return null;
  const at = (id: string) => part.sketch.entities.find(entity => entity.id === id) as CadPoint | undefined;
  let best: { id: string; distance: number } | null = null;
  for (const entity of part.sketch.entities) {
    if (entity.type !== 'line' || entity.construction) continue;
    const a = at(entity.startId),
      b = at(entity.endId);
    if (!a || !b) continue;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    // The face runs along the line, so the line is square to the way the face looks.
    if (length < 1e-9 || Math.abs((dx * facing[0] + dy * facing[1]) / length) > 0.01) continue;
    const t = Math.max(0, Math.min(1, ((local[0] - a.x) * dx + (local[1] - a.y) * dy) / (length * length)));
    const distance = Math.hypot(local[0] - a.x - t * dx, local[1] - a.y - t * dy);
    if (distance < 0.5 && (!best || distance < best.distance)) best = { id: entity.id, distance };
  }
  return best ? { edge: best.id } : null;
}
