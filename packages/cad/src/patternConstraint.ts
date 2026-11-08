import type { SketchPrimitive } from '@salusoft89/planegcs';
import type { CadEntity, CadLinearPattern } from './types';
import { patternMaster, patternInstanceOffset, patternExcluded } from './pattern';

export function patternReplicaIds(patterns: readonly CadLinearPattern[]): Set<string> {
  return new Set(patterns.flatMap(pattern => pattern.instances.filter(i => i !== patternMaster(pattern)).flatMap(i => i.activeIds)));
}
/** Complete affine coverage replaces copied implicit curve equations; source rules retain the analytic support. */
export function linearPatternPrimitives(pattern: CadLinearPattern, entities: ReadonlyMap<string, CadEntity>): SketchPrimitive[] {
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
            difference: 0,
          });
    }
  }
  return result;
}
