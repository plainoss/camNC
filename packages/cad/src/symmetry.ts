import type { SketchPrimitive } from '@salusoft89/planegcs';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import type { CadConstraint, CadEntity, CadPoint, CadPointEntity } from './types';
export function reflectAcrossLine(point: CadPoint, start: CadPoint, end: CadPoint): CadPoint | null {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    length = Math.hypot(dx, dy);
  if (![point.x, point.y, start.x, start.y, end.x, end.y, length].every(Number.isFinite) || length <= CAD_GEOMETRY_TOLERANCE) return null;
  const ux = dx / length,
    uy = dy / length,
    x = point.x - start.x,
    y = point.y - start.y,
    t = x * ux + y * uy;
  const reflected = { x: start.x + 2 * t * ux - x, y: start.y + 2 * t * uy - y };
  return [reflected.x, reflected.y].every(Number.isFinite) ? reflected : null;
}
/** Curves share reflected supports; circular arc endpoints remain independent. */
export function curveSymmetryPrimitives(
  c: Extract<CadConstraint, { type: 'symmetricCurves' }>,
  entities: ReadonlyMap<string, CadEntity>
): SketchPrimitive[] {
  const a = entities.get(c.entityAId)!,
    b = entities.get(c.entityBId)!,
    axis = entities.get(c.lineId)!;
  if (axis.type !== 'line') throw new Error('Symmetry needs a line.');
  const point = (id: string) => entities.get(id) as CadPointEntity;
  const mirror = (id: string) => {
    const p = reflectAcrossLine(point(id), point(axis.startId), point(axis.endId));
    if (!p) throw new Error('Choose a finite, nonzero symmetry line.');
    return p;
  };
  if (a.type === 'line' && b.type === 'line') {
    const result: SketchPrimitive[] = [];
    for (const [i, id] of [a.startId, a.endId].entries()) {
      const reflectedId = `${c.id}:reflected:${i}`;
      result.push(
        { id: reflectedId, type: 'point', ...mirror(id), fixed: false },
        { id: `${c.id}:mirror:${i}`, type: 'p2p_symmetric_ppl', p1_id: id, p2_id: reflectedId, l_id: axis.id }
      );
    }
    result.push(
      { id: `${c.id}:support`, type: 'line', p1_id: `${c.id}:reflected:0`, p2_id: `${c.id}:reflected:1` },
      { id: `${c.id}:direction`, type: 'parallel', l1_id: `${c.id}:support`, l2_id: b.id },
      { id: `${c.id}:position`, type: 'point_on_line_pl', p_id: `${c.id}:reflected:0`, l_id: b.id }
    );
    return result;
  }
  if ((a.type === 'circle' || a.type === 'arc') && (b.type === 'circle' || b.type === 'arc')) {
    const equal: SketchPrimitive =
      a.type === 'circle' && b.type === 'circle'
        ? { id: `${c.id}:radius`, type: 'equal_radius_cc', c1_id: a.id, c2_id: b.id }
        : a.type === 'arc' && b.type === 'arc'
          ? { id: `${c.id}:radius`, type: 'equal_radius_aa', a1_id: a.id, a2_id: b.id }
          : {
              id: `${c.id}:radius`,
              type: 'equal_radius_ca',
              c1_id: a.type === 'circle' ? a.id : b.id,
              a2_id: a.type === 'arc' ? a.id : b.id,
            };
    return [{ id: `${c.id}:center`, type: 'p2p_symmetric_ppl', p1_id: a.centerId, p2_id: b.centerId, l_id: axis.id }, equal];
  }
  if (a.type === 'ellipse' && b.type === 'ellipse') {
    const result: SketchPrimitive[] = [
      { id: `${c.id}:center`, type: 'p2p_symmetric_ppl', p1_id: a.centerId, p2_id: b.centerId, l_id: axis.id },
    ];
    let focus = b.focusId;
    if (c.focusSign === -1) {
      focus = `${c.id}:opposite-focus`;
      const center = point(b.centerId),
        first = point(b.focusId);
      result.push(
        { id: focus, type: 'point', x: 2 * center.x - first.x, y: 2 * center.y - first.y, fixed: false },
        { id: `${c.id}:focus-pair`, type: 'p2p_symmetric_ppp', p1_id: b.focusId, p2_id: focus, p_id: b.centerId }
      );
    }
    result.push(
      { id: `${c.id}:focus`, type: 'p2p_symmetric_ppl', p1_id: a.focusId, p2_id: focus, l_id: axis.id },
      { id: `${c.id}:minor-radius`, type: 'equal', param1: { o_id: a.id, prop: 'radmin' }, param2: { o_id: b.id, prop: 'radmin' } }
    );
    return result;
  }
  throw new Error('Choose two lines, circular curves, or ellipses for symmetry.');
}
