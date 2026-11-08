import type { SketchPrimitive } from '@salusoft89/planegcs';
import { newCadId, constraintEntityIds, entityPointIds } from './document';
import { pointEquivalence } from './pointEquivalence';
import { patternMaster } from './pattern';
import type { CadConstraint, CadSketchPattern, CadSketch } from './types';

/** A join authored on any instance describes the same logical point pair on every affine copy. */
export function patternLogicalPointGroups(sketch: CadSketch, pattern: CadSketchPattern): string[][] {
  const master = patternMaster(pattern);
  if (!master) return [];
  const entities = new Map(sketch.entities.map(e => [e.id, e])),
    logical = Object.keys(master.idMap).filter(key => entities.get(master.idMap[key]!)?.type === 'point');
  const actual = pointEquivalence(sketch.constraints),
    joins: CadConstraint[] = [];
  for (const instance of pattern.instances) {
    const groups = new Map<string, string[]>();
    for (const key of logical) {
      const id = instance.idMap[key];
      if (!id || !instance.activeIds.includes(id) || entities.get(id)?.type !== 'point') continue;
      const root = actual.canonical(id);
      groups.set(root, [...(groups.get(root) ?? []), key]);
    }
    for (const keys of groups.values())
      for (let i = 1; i < keys.length; i++)
        joins.push({ id: `logical:${joins.length}`, type: 'coincident', pointAId: keys[0]!, pointBId: keys[i]! });
  }
  const equivalent = pointEquivalence(joins),
    groups = new Map<string, string[]>();
  for (const key of logical) {
    const root = equivalent.canonical(key);
    groups.set(root, [...(groups.get(root) ?? []), key]);
  }
  return [...groups.values()].filter(keys => keys.length > 1);
}
/** Compile intrinsic joins once, then omit only logically redundant authored coincidence equations. */
export function compilePatternTopology(sketch: CadSketch): { primitives: SketchPrimitive[]; skipCoincidences: Set<string> } {
  const primitives: SketchPrimitive[] = [],
    masterJoins: CadConstraint[] = [],
    known: CadConstraint[] = [];
  for (const pattern of sketch.constraints.filter(c => c.type === 'linearPattern' || c.type === 'circularPattern')) {
    const master = patternMaster(pattern);
    if (!master) continue;
    for (const keys of patternLogicalPointGroups(sketch, pattern)) {
      const a = master.idMap[keys[0]!]!;
      for (let i = 1; i < keys.length; i++) {
        const b = master.idMap[keys[i]!]!;
        if (!pointEquivalence(masterJoins).equivalent(a, b)) {
          const id = `${pattern.id}:intrinsic:${primitives.length}`;
          primitives.push({ id, type: 'p2p_coincident', p1_id: a, p2_id: b });
          masterJoins.push({ id, type: 'coincident', pointAId: a, pointBId: b });
        }
      }
      for (const instance of pattern.instances) {
        const ids = keys.flatMap(key => {
          const id = instance.idMap[key];
          return id && instance.activeIds.includes(id) ? [id] : [];
        });
        for (let i = 1; i < ids.length; i++)
          known.push({ id: `known:${known.length}`, type: 'coincident', pointAId: ids[0]!, pointBId: ids[i]! });
      }
    }
  }
  const skipCoincidences = new Set<string>();
  for (const c of sketch.constraints)
    if (c.type === 'coincident') {
      if (pointEquivalence(known).equivalent(c.pointAId, c.pointBId)) skipCoincidences.add(c.id);
      else known.push(c);
    }
  return { primitives, skipCoincidences };
}
/** Releasing a pattern retains the intrinsic endpoint joins that made its copied profiles continuous. */
export function materializePatternJoins(
  before: CadSketch,
  after: CadSketch,
  pattern: CadSketchPattern,
  onlyCell?: { x: number; y: number }
): CadSketch {
  const next = { ...after, constraints: [...after.constraints] },
    entities = new Map(after.entities.map(e => [e.id, e]));
  for (const keys of patternLogicalPointGroups(before, pattern))
    for (const instance of pattern.instances) {
      if (onlyCell && (instance.x !== onlyCell.x || instance.y !== onlyCell.y)) continue;
      const ids = keys.flatMap(key => {
        const id = instance.idMap[key];
        return id && entities.get(id)?.type === 'point' ? [id] : [];
      });
      for (let i = 1; i < ids.length; i++)
        if (!pointEquivalence(next.constraints).equivalent(ids[0]!, ids[i]!))
          next.constraints.push({ id: newCadId(), type: 'coincident', pointAId: ids[0]!, pointBId: ids[i]! });
    }
  return next;
}

/** A definition center disappears with its pattern unless other geometry or authored relations still use it. */
export function removeUnusedPatternCenters(before: CadSketch, after: CadSketch): CadSketch {
  const candidates = new Set(
    before.constraints.flatMap(c => (c.type === 'circularPattern' && !after.constraints.some(next => next.id === c.id) ? [c.centerId] : []))
  );
  const used = new Set([...after.entities.flatMap(entityPointIds), ...after.constraints.flatMap(constraintEntityIds)]);
  return candidates.size
    ? { ...after, entities: after.entities.filter(e => !candidates.has(e.id) || used.has(e.id) || (e.type === 'point' && e.standalone)) }
    : after;
}
