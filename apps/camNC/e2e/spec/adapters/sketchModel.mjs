/**
 * The ID-free model of a sketch that scenarios compare against, shared by every sketch adapter: how geometry and
 * dimensions are described and matched, and what the geometry expectations mean.
 */

export const POSITION_TOLERANCE_MM = 1.5;
export const VALUE_TOLERANCE = 0.05;

/** Dimension kinds in plain terms, so scenarios don't name internal constraint types. */
export const KINDS = { distance: 'aligned', distanceX: 'horizontal', distanceY: 'vertical', pointLineDistance: 'gap', lineLineDistance: 'gap', pointArcDistance: 'gap', lineCircleDistance: 'gap', circleCircleDistance: 'gap' };

export const point = text => text.split(',').map(Number);
export const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
export const samePoint = (a, b, tolerance) => close(a[0], b[0], tolerance) && close(a[1], b[1], tolerance);

/** A flat, ID-free description of the sketch. */
export function canonical(part) {
  if (!part) return { entities: [], dimensions: [], constraints: [] };
  const { entities, constraints } = part.sketch;
  const points = new Map(entities.filter(e => e.type === 'point').map(e => [e.id, [e.x, e.y]]));
  const out = [];
  for (const e of entities) {
    // A spline's own tangent segments are part of that spline, not separately drawn geometry.
    if (e.owner?.type === 'splineHandle') continue;
    if (e.type === 'point') {
      if (e.standalone) out.push({ type: 'point', at: [e.x, e.y] });
    } else if (e.type === 'circle') {
      out.push({ type: 'circle', c: points.get(e.centerId), r: e.radius, construction: !!e.construction });
    } else if (e.type === 'arc') {
      out.push({ type: 'arc', c: points.get(e.centerId), r: e.radius, a: points.get(e.startId), b: points.get(e.endId), construction: !!e.construction });
    } else {
      out.push({ type: e.type, a: points.get(e.startId), b: points.get(e.endId), construction: !!e.construction });
    }
  }
  return {
    entities: out,
    dimensions: constraints.filter(c => typeof c.value === 'number').map(c => ({ kind: KINDS[c.type] ?? c.type, value: c.value, driven: !!c.driven })),
    constraints: constraints.filter(c => typeof c.value !== 'number').map(c => c.type),
  };
}

export function entityMatches(expected, actual) {
  if (expected.type !== actual.type) return false;
  const tolerance = expected.tol ?? POSITION_TOLERANCE_MM;
  if (expected.at && !samePoint(expected.at, actual.at, tolerance)) return false;
  if (expected.c && !samePoint(expected.c, actual.c, tolerance)) return false;
  if (expected.r !== undefined && !close(expected.r, actual.r, tolerance)) return false;
  if (expected.a && expected.b) {
    const direct = samePoint(expected.a, actual.a, tolerance) && samePoint(expected.b, actual.b, tolerance);
    const swapped = samePoint(expected.a, actual.b, tolerance) && samePoint(expected.b, actual.a, tolerance);
    if (!direct && !swapped) return false;
  }
  return expected.construction === undefined || expected.construction === actual.construction;
}

/** Every expected item must claim a different actual item. */
export function unmatched(expected, actual, matches) {
  const left = [...actual];
  const missing = [];
  for (const item of expected) {
    const index = left.findIndex(candidate => matches(item, candidate));
    if (index < 0) missing.push(item);
    else left.splice(index, 1);
  }
  return { missing, extra: left };
}

export const dimensionMatches = (expected, actual) =>
  (expected.kind === undefined || expected.kind === actual.kind) &&
  (expected.value === undefined || close(expected.value, actual.value, expected.tol ?? VALUE_TOLERANCE)) &&
  (expected.driven === undefined || expected.driven === actual.driven);

/** The expectation keys answered from the sketch's geometry, dimensions and relations. */
export const SKETCH_KEYS = ['entities', 'entitiesInclude', 'entityCount', 'dimensions', 'dimensionsInclude', 'constraintsAtLeast', 'constraintsNone'];

/** Checks the geometry expectations against a part's canonical sketch, reporting through `fail(name, want, got)`. */
export function checkSketch(expect, state, fail) {
  if ('entityCount' in expect && state.entities.length !== expect.entityCount) fail('entityCount', expect.entityCount, state.entities.length);
  for (const [key, exact] of [['entities', true], ['entitiesInclude', false]]) {
    if (!(key in expect)) continue;
    const { missing, extra } = unmatched(expect[key], state.entities, entityMatches);
    if (missing.length || (exact && extra.length)) fail(key, expect[key], state.entities);
  }
  for (const [key, exact] of [['dimensions', true], ['dimensionsInclude', false]]) {
    if (!(key in expect)) continue;
    const { missing, extra } = unmatched(expect[key], state.dimensions, dimensionMatches);
    if (missing.length || (exact && extra.length)) fail(key, expect[key], state.dimensions);
  }
  for (const [type, count] of Object.entries(expect.constraintsAtLeast ?? {})) {
    const got = state.constraints.filter(item => item === type).length;
    if (got < count) fail(`constraint ${type}`, `at least ${count}`, state.constraints);
  }
  for (const type of expect.constraintsNone ?? []) if (state.constraints.includes(type)) fail(`constraint ${type}`, 'none', state.constraints);
}
