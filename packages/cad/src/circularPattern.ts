import { newCadId } from './document';
import { linearPatternSketchEntities, reconcileLinearPattern, rebaseLinearPattern, patternExcluded } from './pattern';
import type { CadSketch, CadPoint, CadCircularPattern } from './types';
import type { CadPatternResult } from './pattern';
export interface CadCircularPatternOptions {
  entityIds?: readonly string[];
  count: number;
  angle?: number;
  closed?: boolean;
  center?: CadPoint;
  patternId?: string;
  previewLimit?: number;
}
export function circularPatternSketchEntities(sketch: CadSketch, options: CadCircularPatternOptions): CadPatternResult {
  const existing = options.patternId ? sketch.constraints.find(c => c.id === options.patternId) : undefined;
  if (existing && existing.type !== 'circularPattern') return { ok: false, message: 'Select a circular pattern to edit.' };
  let group: CadCircularPattern;
  if (existing) {
    group = structuredClone(existing);
    if (group.masterX >= options.count) {
      const entities = new Set(sketch.entities.map(e => e.id)),
        target = group.instances.find(
          i => i.x < options.count && group.seedKeys.every(key => !patternExcluded(group, key, i.x, i.y) && entities.has(i.idMap[key]!))
        );
      if (!target) return { ok: false, message: 'Keep a complete surviving instance inside the requested pattern range.' };
      const rebased = rebaseLinearPattern(sketch, sketch, group, target.x, 0);
      if (!rebased.ok) return rebased;
      if (rebased.pattern.type !== 'circularPattern') return { ok: false, message: 'Invalid circular pattern.' };
      sketch = rebased.sketch;
      group = rebased.pattern;
    }
    group.countX = options.count;
    group.angle = options.angle ?? group.angle;
    group.closed = options.closed ?? group.closed;
    if (options.center) {
      const current = sketch.entities.find(e => e.id === group.centerId);
      if (current?.type === 'point' && current.fixed && Math.hypot(current.x - options.center.x, current.y - options.center.y) > 1e-6)
        return { ok: false, message: 'Unfix the pattern center before moving it.' };
      if (![options.center.x, options.center.y].every(Number.isFinite)) return { ok: false, message: 'Enter a finite pattern center.' };
      sketch = {
        ...sketch,
        entities: sketch.entities.map(e => (e.id === group.centerId && e.type === 'point' ? { ...e, ...options.center } : e)),
      };
    }
  } else {
    // Reuse source-graph selection and ID allocation, then replace the placement law before solving.
    const seed = linearPatternSketchEntities(sketch, {
      entityIds: options.entityIds,
      countX: options.count,
      stepX: { x: 1, y: 0 },
      patternId: options.patternId,
    });
    if (!seed.ok) return seed;
    const linear = seed.sketch.constraints.find(c => c.id === seed.patternId)!;
    if (linear.type !== 'linearPattern') return { ok: false, message: 'Invalid pattern source.' };
    const { type: _, stepX: __, stepY: ___, ...base } = linear;
    const center = options.center ?? { x: 0, y: 0 };
    if (![center.x, center.y].every(Number.isFinite)) return { ok: false, message: 'Enter a finite pattern center.' };
    group = {
      ...base,
      type: 'circularPattern',
      centerId: newCadId(),
      angle: options.angle ?? 360,
      closed: options.closed ?? Math.abs(options.angle ?? 360) === 360,
      label: 'Circular pattern',
    };
    sketch = {
      ...seed.sketch,
      entities: [...seed.sketch.entities, { id: group.centerId, type: 'point', ...center, construction: true }],
      constraints: seed.sketch.constraints.filter(c => c.id !== group.id),
    };
  }
  return reconcileLinearPattern(sketch, group, options.previewLimit);
}
