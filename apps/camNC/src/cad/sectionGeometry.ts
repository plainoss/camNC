import { ShapeUtils, Vector2 } from 'three';
import type { BodyMesh } from '@/cam/camTypes';
import {
  sectionContains,
  sectionContourArea,
  sectionContours,
  sectionEdges,
  type SectionSegment,
  type SectionVec3,
} from './sectionTopology';

export type { SectionVec3 } from './sectionTopology';
/** The retained halfspace is dot(point-origin, normal) <= 0; the new cap faces along normal. */
export interface SectionPlane {
  origin: SectionVec3;
  normal: SectionVec3;
}
export interface SectionGeometry {
  body: BodyMesh;
  cap: BodyMesh | null;
  /** Unsupported geometry stays uncut; no guessed cap is substituted for a missing boundary. */
  problem?: string;
}
type Triangle = [SectionVec3, SectionVec3, SectionVec3];
interface Vertex {
  id: number;
  source: SectionVec3;
  point: SectionVec3;
  distance: number;
}
const solidChecks = new WeakMap<Float32Array, { indices: Uint32Array; problem?: string }>();

const sub = (a: SectionVec3, b: SectionVec3): SectionVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: SectionVec3, b: SectionVec3): SectionVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: SectionVec3, s: number): SectionVec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: SectionVec3, b: SectionVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: SectionVec3, b: SectionVec3): SectionVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: SectionVec3) => Math.hypot(...a);
const validPoint = (a: SectionVec3) => a.length === 3 && a.every(Number.isFinite);
const nonzero = ([a, b, c]: Triangle) => length(cross(sub(b, a), sub(c, a))) > 0;
const segmentsOf = ([a, b, c]: Triangle): SectionSegment[] => [
  { a, b },
  { a: b, b: c },
  { a: c, b: a },
];

function meshOf(mesh: BodyMesh, triangles: Triangle[]): BodyMesh {
  const positions = new Float32Array(triangles.length * 9);
  let i = 0;
  for (const triangle of triangles) for (const point of triangle) for (const value of point) positions[i++] = value;
  return { ...mesh, positions, indices: Uint32Array.from({ length: positions.length / 3 }, (_, index) => index) };
}

function collapsedTriangles(mesh: BodyMesh): boolean {
  const points = mesh.positions;
  if (!points.every(Number.isFinite)) return true;
  for (let i = 0; i < points.length; i += 9) {
    const bx = points[i + 3]! - points[i]!,
      by = points[i + 4]! - points[i + 1]!,
      bz = points[i + 5]! - points[i + 2]!;
    const cx = points[i + 6]! - points[i]!,
      cy = points[i + 7]! - points[i + 1]!,
      cz = points[i + 8]! - points[i + 2]!;
    if (by * cz === bz * cy && bz * cx === bx * cz && bx * cy === by * cx) return true;
  }
  return false;
}

function retainedVolume(body: BodyMesh, cap: BodyMesh | null): number {
  const [x = 0, y = 0, z = 0] = body.positions;
  let volume = 0;
  for (const mesh of cap ? [body, cap] : [body])
    for (let i = 0; i < mesh.positions.length; i += 9) {
      const points = mesh.positions;
      const ax = points[i]! - x,
        ay = points[i + 1]! - y,
        az = points[i + 2]! - z;
      const bx = points[i + 3]! - x,
        by = points[i + 4]! - y,
        bz = points[i + 5]! - z;
      const cx = points[i + 6]! - x,
        cy = points[i + 7]! - y,
        cz = points[i + 8]! - z;
      volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    }
  return volume;
}

function solidProblem(mesh: BodyMesh, triangles: Triangle[], tolerance: number): string | undefined {
  // Like modelGeometry's memoization, this cache treats supplied BodyMesh buffers as immutable.
  const previous = solidChecks.get(mesh.positions);
  if (previous?.indices === mesh.indices) return previous.problem;
  const boundary = sectionEdges(triangles.flatMap(segmentsOf), tolerance, true);
  let problem = boundary.problem;
  if (!problem) {
    const reference = triangles[0]?.[0] ?? [0, 0, 0];
    const volume = triangles.reduce((sum, [a, b, c]) => sum + dot(sub(a, reference), cross(sub(b, reference), sub(c, reference))) / 6, 0);
    if (!(volume > 0)) problem = 'The part mesh is not a closed solid with outward faces.';
  }
  solidChecks.set(mesh.positions, { indices: mesh.indices, ...(problem && { problem }) });
  return problem;
}

/** CPU clipping keeps displayed geometry, raycasts and finite measurement faces in the same retained halfspace. */
export function sectionGeometry(mesh: BodyMesh, plane: SectionPlane): SectionGeometry {
  const failed = (problem: string): SectionGeometry => ({ body: mesh, cap: null, problem });
  const complete = (retained: Triangle[], caps: Triangle[] = []): SectionGeometry => {
    // Boundary welding can make two cut vertices exactly equal. Those triangles already occupy no double-precision
    // area; remove them before conversion, while retaining every positive-area triangle for the precision check.
    const finite = retained.filter(nonzero),
      body = meshOf(mesh, finite),
      cap = caps.length ? meshOf(mesh, caps) : null;
    // A finite cut can collapse after conversion to the display mesh's Float32 buffers, especially far from the origin.
    // Keep the source visible with a diagnostic instead of silently returning degenerate faces or a flattened solid.
    if (collapsedTriangles(body) || (cap && collapsedTriangles(cap)) || (finite.length > 0 && !(retainedVolume(body, cap) > 0)))
      return failed('The section cannot preserve its boundary at the mesh coordinate precision. Move the plane slightly.');
    return { body, cap };
  };
  if (!validPoint(plane.origin) || !validPoint(plane.normal) || !length(plane.normal) || !Number.isFinite(length(plane.normal)))
    return failed('Choose a finite section plane with a nonzero normal.');
  if (
    mesh.positions.length % 3 ||
    mesh.indices.length % 3 ||
    !mesh.positions.every(Number.isFinite) ||
    !mesh.indices.every(index => Number.isInteger(index) && index >= 0 && index * 3 + 2 < mesh.positions.length)
  )
    return failed('The part mesh has invalid coordinates or triangle indices.');
  if (!mesh.indices.length) return { body: mesh, cap: null };
  const normal = scale(plane.normal, 1 / length(plane.normal));
  let magnitude = 1;
  for (const value of mesh.positions) magnitude = Math.max(magnitude, Math.abs(value));
  // Classification uses double arithmetic. Topology welding separately admits one Float32 rounding step in the input mesh.
  const tolerance = Math.max(1e-8, magnitude * 2 ** -24);
  const onPlane = new Set<SectionVec3>(),
    byPosition = new Map<string, Vertex>(),
    byIndex = new Map<number, Vertex>();
  const sourceVertex = (index: number): Vertex => {
    const cached = byIndex.get(index);
    if (cached) return cached;
    const source: SectionVec3 = [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!];
    const key = source.join(','),
      previous = byPosition.get(key);
    if (previous) {
      byIndex.set(index, previous);
      return previous;
    }
    const local = sub(source, plane.origin),
      signed = dot(local, normal);
    const classification =
      Math.max(
        1,
        local.reduce((sum, value, axis) => sum + Math.abs(value * normal[axis]!), 0)
      ) *
      Number.EPSILON *
      64;
    const distance = Math.abs(signed) <= classification ? 0 : signed;
    const point = distance === 0 ? sub(source, scale(normal, signed)) : source;
    if (distance === 0) onPlane.add(point);
    const vertex = { id: byPosition.size, source, point, distance };
    byPosition.set(key, vertex);
    byIndex.set(index, vertex);
    return vertex;
  };
  const input = Array.from(
    { length: mesh.indices.length / 3 },
    (_, i) => [0, 1, 2].map(k => sourceVertex(mesh.indices[i * 3 + k]!)) as [Vertex, Vertex, Vertex]
  );
  const triangles = input.map(triangle => triangle.map(vertex => vertex.source) as Triangle).filter(nonzero);
  if (!triangles.length) return failed('The part mesh has no solid surface.');
  const distances = [...byPosition.values()].map(vertex => vertex.distance);
  if (distances.every(value => value < 0)) return { body: mesh, cap: null };
  if (distances.every(value => value >= 0)) {
    // A closed halfspace retains a supporting face even when no solid volume remains. Reuse only actual coplanar
    // source triangles: edge/vertex contact has no area, and an open or inward mesh must not acquire a guessed cap.
    const touching = input
      .filter(triangle => triangle.every(vertex => vertex.distance === 0))
      .map(triangle => triangle.map(vertex => vertex.point) as Triangle)
      .filter(nonzero);
    if (!touching.length) return { body: meshOf(mesh, []), cap: null };
    const problem = solidProblem(mesh, triangles, tolerance);
    if (problem) return failed(problem);
    const cap = touching.map(([a, b, c]): Triangle => (dot(cross(sub(b, a), sub(c, a)), normal) > 0 ? [a, b, c] : [a, c, b]));
    return complete([], cap);
  }
  const problem = solidProblem(mesh, triangles, tolerance);
  if (problem) return failed(problem);
  const basis = [0, 1, 2].map(axis => Math.abs(normal[axis]!)),
    axis = basis.indexOf(Math.min(...basis));
  const reference: SectionVec3 = [0, 0, 0];
  reference[axis] = 1;
  const along = cross(reference, normal),
    u = scale(along, 1 / length(along)),
    v = cross(normal, u);
  // The supplied origin can lie arbitrarily far along its plane. A nearby frame prevents that harmless choice from
  // inflating UV values or destroying small boundaries when the cap is transformed back to world coordinates.
  const first = input[0]![0],
    frame = sub(first.point, scale(normal, first.distance));
  const project = (point: SectionVec3): SectionVec3 => {
    const local = sub(point, frame);
    return [dot(local, u), dot(local, v), 0];
  };
  const unproject = (point: SectionVec3): SectionVec3 => add(frame, add(scale(u, point[0]), scale(v, point[1])));
  const intersections = new Map<string, Vertex>();
  const intersection = (a: Vertex, b: Vertex): Vertex => {
    if (a.distance === 0) return a;
    if (b.distance === 0) return b;
    const key = [a.id, b.id].sort((p, q) => p - q).join('/'),
      cached = intersections.get(key);
    if (cached) return cached;
    const t = a.distance / (a.distance - b.distance),
      raw = add(a.point, scale(sub(b.point, a.point), t));
    const point = sub(raw, scale(normal, dot(sub(raw, plane.origin), normal)));
    const vertex = { id: byPosition.size + intersections.size, source: point, point, distance: 0 };
    onPlane.add(point);
    intersections.set(key, vertex);
    return vertex;
  };
  const retained: Triangle[] = [],
    boundary: SectionSegment[] = [];
  for (const triangle of input) {
    // Coplanar originals are replaced once by the cap, preventing duplicate original/section faces and z fighting.
    if (triangle.every(vertex => vertex.distance === 0)) continue;
    const polygon: Vertex[] = [];
    for (let i = 0; i < 3; i++) {
      const a = triangle[i]!,
        b = triangle[(i + 1) % 3]!,
        insideA = a.distance <= 0,
        insideB = b.distance <= 0;
      if (insideA !== insideB) polygon.push(intersection(a, b));
      if (insideB) polygon.push(b);
    }
    const points = polygon.filter((vertex, i) => i === 0 || vertex.point !== polygon[i - 1]!.point).map(vertex => vertex.point);
    if (points.length > 1 && points[0] === points.at(-1)) points.pop();
    for (let i = 1; i + 1 < points.length; i++) {
      const kept: Triangle = [points[0]!, points[i]!, points[i + 1]!];
      if (!nonzero(kept)) continue;
      retained.push(kept);
      for (const edge of segmentsOf(kept))
        if (onPlane.has(edge.a) && onPlane.has(edge.b)) boundary.push({ a: project(edge.b), b: project(edge.a) });
    }
  }
  if (!boundary.length) return complete(retained);
  const contours = sectionContours(boundary, tolerance);
  if (contours.problem) return failed(contours.problem);
  const loops = contours.loops.map(points => ({ points, area: sectionContourArea(points), parent: -1, depth: 0 }));
  loops.forEach((loop, index) => {
    const containing = loops.flatMap((other, j) =>
      j !== index && Math.abs(other.area) > Math.abs(loop.area) && sectionContains(other.points, loop.points[0]!) ? [j] : []
    );
    loop.parent = containing.sort((a, b) => Math.abs(loops[a]!.area) - Math.abs(loops[b]!.area))[0] ?? -1;
    loop.depth = containing.length;
  });
  if (loops.some(loop => loop.area > 0 !== (loop.depth % 2 === 0)))
    return failed('The part mesh has inconsistent face orientation at the section.');
  const caps: Triangle[] = [];
  for (const [index, loop] of loops.entries()) {
    if (loop.depth % 2) continue;
    const holes = loops.filter(other => other.parent === index && other.depth % 2);
    const outer = loop.points.map(point => new Vector2(point[0], point[1])),
      rings = holes.map(hole => hole.points.map(point => new Vector2(point[0], point[1])));
    const vertices = [...outer, ...rings.flat()];
    for (const [a, b, c] of ShapeUtils.triangulateShape(outer, rings)) {
      const aa = vertices[a!]!,
        bb = vertices[b!]!,
        cc = vertices[c!]!;
      const counterclockwise = (bb.x - aa.x) * (cc.y - aa.y) - (bb.y - aa.y) * (cc.x - aa.x) > 0;
      const points = [aa, ...(counterclockwise ? [bb, cc] : [cc, bb])].map(point => unproject([point.x, point.y, 0])) as Triangle;
      if (nonzero(points)) caps.push(points);
    }
  }
  const expectedArea = loops.reduce((sum, loop) => sum + loop.area, 0);
  const capArea = caps.reduce((sum, [a, b, c]) => sum + length(cross(sub(b, a), sub(c, a))) / 2, 0);
  if (Math.abs(expectedArea - capArea) > Math.max(1e-8, expectedArea * 1e-8))
    return failed('The section contours could not be triangulated without losing material.');
  const snapCache = new Map<SectionVec3, SectionVec3>();
  const snapped = retained.map(
    triangle =>
      triangle.map(point => {
        if (!onPlane.has(point)) return point;
        const previous = snapCache.get(point);
        if (previous) return previous;
        const next = unproject(contours.snap(project(point)));
        snapCache.set(point, next);
        return next;
      }) as Triangle
  );
  return complete(snapped, caps);
}
