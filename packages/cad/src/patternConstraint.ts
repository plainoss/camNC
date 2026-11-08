import { patternAngle } from './patternPlacement';
import type { SketchPrimitive } from '@salusoft89/planegcs';
import type { CadEntity, CadSketchPattern } from './types';
import { patternMaster, patternInstanceOffset, patternExcluded } from './pattern';

export function patternReplicaIds(patterns: readonly CadSketchPattern[]): Set<string> {
  return new Set(patterns.flatMap(pattern => pattern.instances.filter(i => i !== patternMaster(pattern)).flatMap(i => i.activeIds)));
}
/** Complete affine coverage replaces copied implicit curve equations; source rules retain the analytic support. */
export function linearPatternPrimitives(pattern: CadSketchPattern, entities: ReadonlyMap<string, CadEntity>): SketchPrimitive[] {
  const master = patternMaster(pattern)!;
  const result: SketchPrimitive[] = [];
  for (const instance of pattern.instances) {
    if (instance === master || !instance.activeIds.length) continue;
    const active = new Set(instance.activeIds),
      offset = patternInstanceOffset(pattern, instance),
      prefix = `${pattern.id}:cell:${instance.x}:${instance.y}`;
    for (const [key, sourceId] of Object.entries(master.idMap)) {
      const targetId = instance.idMap[key];
      if (!targetId || !active.has(targetId) || entities.get(sourceId)?.type !== 'point') continue;
      if (pattern.type === 'circularPattern') {
        const source = entities.get(sourceId)!,
          center = entities.get(pattern.centerId)!;
        if (source.type !== 'point' || center.type !== 'point') continue;
        const angle = patternAngle(pattern, instance),
          base = `${prefix}:point:${key}`,
          horizontal = `${base}:axis0`,
          bisector = `${base}:axis1`,
          reflected = `${base}:reflected`;
        for (const [id, x, y] of [
          [horizontal, center.x + 1, center.y],
          [bisector, center.x + Math.cos(angle / 2), center.y + Math.sin(angle / 2)],
          [reflected, source.x, 2 * center.y - source.y],
        ] as [string, number, number][])
          result.push({ id, type: 'point', x, y, fixed: false });
        for (const [id, dx, dy] of [
          [horizontal, 1, 0],
          [bisector, Math.cos(angle / 2), Math.sin(angle / 2)],
        ] as [string, number, number][]) {
          result.push({ id: `${id}:line`, type: 'line', p1_id: pattern.centerId, p2_id: id });
          for (const prop of ['x', 'y'] as const)
            result.push({
              id: `${id}:${prop}`,
              type: 'difference',
              param1: { o_id: pattern.centerId, prop },
              param2: { o_id: id, prop },
              difference: prop === 'x' ? dx : dy,
            });
        }
        result.push(
          { id: `${base}:reflect0`, type: 'p2p_symmetric_ppl', p1_id: sourceId, p2_id: reflected, l_id: `${horizontal}:line` },
          { id: `${base}:reflect1`, type: 'p2p_symmetric_ppl', p1_id: reflected, p2_id: targetId, l_id: `${bisector}:line` }
        );
      } else
        for (const prop of ['x', 'y'] as const)
          result.push({
            id: `${prefix}:point:${key}:${prop}`,
            type: 'difference',
            param1: { o_id: sourceId, prop },
            param2: { o_id: targetId, prop },
            difference: offset[prop],
          });
    }
    for (const key of pattern.seedKeys) {
      if (patternExcluded(pattern, key, instance.x, instance.y)) continue;
      const source = entities.get(master.idMap[key]!),
        targetId = instance.idMap[key];
      if (!source || !targetId || !active.has(targetId)) continue;
      if (source.type === 'circle' || source.type === 'arc' || source.type === 'ellipse')
        result.push({
          id: `${prefix}:radius:${key}`,
          type: 'equal',
          param1: { o_id: source.id, prop: source.type === 'ellipse' ? 'radmin' : 'radius' },
          param2: { o_id: targetId, prop: source.type === 'ellipse' ? 'radmin' : 'radius' },
        });
      if (source.type === 'arc')
        for (const prop of ['start_angle', 'end_angle'] as const)
          result.push({
            id: `${prefix}:${key}:${prop}`,
            type: 'difference',
            param1: { o_id: source.id, prop },
            param2: { o_id: targetId, prop },
            difference: patternAngle(pattern, instance),
          });
    }
  }
  return result;
}
