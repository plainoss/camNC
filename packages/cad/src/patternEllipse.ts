import { conditionEllipseAxes } from './ellipse';
import { pointEquivalence } from './pointEquivalence';
import { patternMaster } from './pattern';
import { patternReplicaIds } from './patternConstraint';
import type { CadConstraint, CadSketch } from './types';

/** Condition the independent ellipse roles before cloning them. Replica span drivers can condition the same source axes. */
export function conditionPatternEllipseAxes(sketch: CadSketch): void {
  const patterns = sketch.constraints.filter(c => c.type === 'linearPattern'),
    replicas = patternReplicaIds(patterns);
  const toSource = new Map<string, string>(),
    equivalent = pointEquivalence(sketch.constraints);
  for (const pattern of patterns) {
    const master = patternMaster(pattern);
    if (!master) continue;
    for (const instance of pattern.instances)
      if (instance !== master)
        for (const [key, id] of Object.entries(master.idMap)) {
          const target = instance.idMap[key];
          if (target && instance.activeIds.includes(target)) toSource.set(equivalent.canonical(target), equivalent.canonical(id));
        }
  }
  const extra: CadConstraint[] = [];
  for (const c of sketch.constraints)
    if (c.type === 'distance' || c.type === 'distanceX' || c.type === 'distanceY') {
      let a = equivalent.canonical(c.pointAId),
        b = equivalent.canonical(c.pointBId);
      const seen = new Set<string>();
      while (toSource.has(a) && toSource.has(b) && !seen.has(a)) {
        seen.add(a);
        a = toSource.get(a)!;
        b = toSource.get(b)!;
        extra.push({ ...c, id: `${c.id}:conditioning:${extra.length}`, pointAId: a, pointBId: b });
      }
    }
  conditionEllipseAxes({
    ...sketch,
    entities: sketch.entities.filter(e => e.type !== 'ellipse' || !replicas.has(e.id)),
    constraints: [...sketch.constraints, ...extra],
  });
}
