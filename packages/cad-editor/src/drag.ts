import { entityPointIds, pointEquivalence, type CadDocument, type CadPoint, type CadSketch } from '@wbcnc/cad';

/** Pointer intent targets selected geometry; shared vertices and constraints propagate the edit. */
export function dragTargets(sketch: CadSketch, selectedIds: string[], delta: CadPoint) {
  const equivalent = pointEquivalence(sketch.constraints);
  const fixed = new Set(sketch.entities.filter(e => e.type === 'point' && e.fixed).map(e => equivalent.canonical(e.id)));
  const ids = new Set(
    selectedIds.flatMap(id => {
      const entity = sketch.entities.find(e => e.id === id);
      if (!entity) return [];
      if (entity.type === 'point') {
        if (entity.fixed) return [];
        const owners = sketch.entities.filter(
          e => e.type === 'ellipse' && equivalent.equivalent(e.centerId, entity.id) && !fixed.has(equivalent.canonical(e.centerId))
        );
        const polygons = sketch.constraints.flatMap(c => {
          if (c.type !== 'regularPolygon') return [];
          const circle = sketch.entities.find(e => e.id === c.circleId);
          if (
            circle?.type !== 'circle' ||
            !equivalent.equivalent(circle.centerId, entity.id) ||
            fixed.has(equivalent.canonical(circle.centerId))
          )
            return [];
          return [circle.id, ...c.edgeIds].flatMap(id => {
            const e = sketch.entities.find(e => e.id === id);
            return e ? entityPointIds(e) : [];
          });
        });
        return [entity.id, ...owners.flatMap(entityPointIds), ...polygons];
      }
      return entityPointIds(entity);
    })
  );
  return sketch.entities.flatMap(e =>
    e.type === 'point' && !e.fixed && ids.has(e.id) ? [{ pointId: e.id, x: e.x + delta.x, y: e.y + delta.y }] : []
  );
}

/** Native solver rounding alone must not create an undo step for a constrained drag. */
export function hasDragMovement(before: CadDocument, after: CadDocument): boolean {
  return before.parts.some(part => {
    const changed = after.parts.find(p => p.id === part.id);
    return part.sketch.entities.some(entity => {
      const next = changed?.sketch.entities.find(e => e.id === entity.id);
      if (entity.type === 'point' && next?.type === 'point') return Math.hypot(entity.x - next.x, entity.y - next.y) > 1e-6;
      if ((entity.type === 'circle' || entity.type === 'arc') && (next?.type === 'circle' || next?.type === 'arc'))
        return Math.abs(entity.radius - next.radius) > 1e-6;
      return false;
    });
  });
}
