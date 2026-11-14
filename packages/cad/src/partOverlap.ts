import { isCadPart } from './features';
import { evaluateCadPart, pointInPolygon } from './geometry';
import { resolveDrawnPlacements } from './drawnOn';
import { placePoint, rotateVector } from './placement';
import type { CadDocument, CadPart, CadPoint } from './types';

type Vec = [number, number, number];
const EPS = 1e-6;

/** A part's outline and depth along its sketch normal, in the plane of `frame`, or null when it isn't extruded along it. */
function footprint(part: CadPart, normal: Vec, x: Vec, y: Vec) {
  const shape = evaluateCadPart(part).part;
  if (!shape || !part.placement) return null;
  const own = rotateVector(part.placement.rotation, [0, 0, 1]);
  if (Math.abs(Math.abs(own[0] * normal[0] + own[1] * normal[1] + own[2] * normal[2]) - 1) > EPS) return null;
  const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const outline = shape.outline.map(p => {
    const at = placePoint(part.placement, [p.x, p.y, 0]);
    return { x: dot(at, x), y: dot(at, y) };
  });
  const ends = [0, shape.thickness].map(z => dot(placePoint(part.placement, [shape.outline[0]!.x, shape.outline[0]!.y, z]), normal));
  const holes = shape.holes.map(hole =>
    hole.map(p => {
      const at = placePoint(part.placement, [p.x, p.y, 0]);
      return { x: dot(at, x), y: dot(at, y) };
    })
  );
  return { outline, holes, lo: Math.min(...ends), hi: Math.max(...ends) };
}

const crosses = (a: CadPoint, b: CadPoint, c: CadPoint, d: CadPoint) => {
  const side = (p: CadPoint, q: CadPoint, r: CadPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < -EPS && side(c, d, a) * side(c, d, b) < -EPS;
};

const onEdge = (point: CadPoint, poly: CadPoint[]) =>
  poly.some((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const along = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (length * length || 1);
    const across = Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / (length || 1);
    return across < EPS && along > -EPS && along < 1 + EPS;
  });
const strictlyInside = (point: CadPoint, poly: CadPoint[]) => !onEdge(point, poly) && pointInPolygon(point, poly);

/** Points just inside an outline, beside the middle of each edge. */
function innerPoints(poly: CadPoint[]) {
  return poly.flatMap((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      step = { x: (-(b.y - a.y) / length) * 1e-3, y: ((b.x - a.x) / length) * 1e-3 };
    return [
      { x: middle.x + step.x, y: middle.y + step.y },
      { x: middle.x - step.x, y: middle.y - step.y },
    ].filter(point => strictlyInside(point, poly));
  });
}

/**
 * Whether a new outline shares some area with a part's material: an edge of one crosses the other's outline, or a point
 * just inside one is inside the other, and not in one of the part's holes, as a dowel drawn in a ring's hole is.
 */
function overlaps(a: CadPoint[], b: { outline: CadPoint[]; holes: CadPoint[][] }) {
  const material = (point: CadPoint) => strictlyInside(point, b.outline) && !b.holes.some(hole => pointInPolygon(point, hole));
  if (b.holes.length) return innerPoints(a).some(material);
  const edges = (poly: CadPoint[]) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as const);
  if (edges(a).some(([p, q]) => edges(b.outline).some(([r, s]) => crosses(p, q, r, s)))) return true;
  return innerPoints(a).some(material) || innerPoints(b.outline).some(point => strictlyInside(point, a));
}

/**
 * The earlier parts a part's material runs into: parts extruded along the same normal that share some volume with it,
 * in design order. Touching an edge or a face isn't running into a part, nor is lying in one of its holes.
 */
export function overlappedParts(document: CadDocument, partId: string): string[] {
  const placed = resolveDrawnPlacements(document).document;
  const part = placed.parts.find(p => p.id === partId);
  if (!part?.placement) return [];
  const normal = rotateVector(part.placement.rotation, [0, 0, 1]) as Vec;
  const x = rotateVector(part.placement.rotation, [1, 0, 0]) as Vec,
    y = rotateVector(part.placement.rotation, [0, 1, 0]) as Vec;
  const own = footprint(part, normal, x, y);
  if (!own) return [];
  return placed.parts.slice(0, placed.parts.indexOf(part)).flatMap(other => {
    if (!isCadPart(other) || other.id === part.id) return [];
    const theirs = footprint(other, normal, x, y);
    return theirs && Math.min(own.hi, theirs.hi) - Math.max(own.lo, theirs.lo) > EPS && overlaps(own.outline, theirs) ? [other.id] : [];
  });
}
