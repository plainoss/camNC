import type { SketchPrimitive } from '@salusoft89/planegcs';
import type { CadConstraint, CadEntity, CadSlot, CadSlotMember } from './types';
import { offsetNativePrimitives } from './offsetConstraint';
/** Cap endpoints already lie on their circles through the normal-offset support links. */
export function slotPrimitives(
  slot: CadSlot,
  entities: ReadonlyMap<string, CadEntity>,
  constraints: readonly CadConstraint[]
): SketchPrimitive[] {
  const half = { o_id: slot.widthEntityId, prop: 'radius' as const },
    result: SketchPrimitive[] = [];
  for (let i = 0; i < slot.members.length; i++) {
    const member = slot.members[i]!,
      prefix = `${slot.id}:support:${i}`,
      source = entities.get(member.sourceId)!,
      target = entities.get(member.targetId)!;
    const anchoredEnds = slotAnchoredEnds(slot, member, entities);
    const generated = offsetNativePrimitives(
      { id: prefix, type: 'offset', value: 1, members: [member.kind === 'circle' ? member : { ...member, endpoints: false }] },
      entities,
      constraints
    );
    result.push(
      ...generated
        .filter(p =>
          member.kind === 'line' && anchoredEnds.length
            ? anchoredEnds.length === 1 && p.type === 'parallel'
            : p.type !== 'p2p_coincident' || p.p1_id !== p.p2_id
        )
        .map(p => {
          if (p.type === 'p2p_distance') return { ...p, distance: half };
          if (p.type === 'difference') return { ...p, difference: half };
          return p;
        })
    );
    if (member.kind === 'line' && source.type === 'line' && target.type === 'line')
      for (const end of member.normalEnds) {
        const from = end === 'start' ? source.startId : source.endId,
          to = end === 'start' ? target.startId : target.endId,
          id = `${prefix}:normal:${end}`;
        result.push(
          { id, type: 'line', p1_id: from, p2_id: to },
          { id: `${id}:angle`, type: 'l2l_angle_ll', l1_id: source.id, l2_id: id, angle: (member.side * Math.PI) / 2 }
        );
      }
    if (member.kind === 'arc' && target.type === 'arc' && anchoredEnds.length) {
      for (const end of ['start', 'end'] as const) {
        const point = end === 'start' ? target.startId : target.endId,
          prop = end === 'start' ? 'start_angle' : 'end_angle';
        result.push({
          id: `${prefix}:support-angle:${end}`,
          type: 'p2p_angle',
          p1_id: target.centerId,
          p2_id: point,
          angle: { o_id: target.id, prop },
        });
        if (!anchoredEnds.includes(end))
          result.push({
            id: `${prefix}:support-radius:${end}`,
            type: 'p2p_distance',
            p1_id: target.centerId,
            p2_id: point,
            distance: { o_id: target.id, prop: 'radius' },
          });
      }
    }
    if (member.kind === 'arc' && source.type === 'arc' && target.type === 'arc')
      for (const end of member.normalEnds) {
        const prop = end === 'start' ? 'start_angle' : 'end_angle';
        result.push({ id: `${prefix}:${end}`, type: 'equal', param1: { o_id: source.id, prop }, param2: { o_id: target.id, prop } });
      }
  }
  for (const id of slot.capIds) {
    const cap = entities.get(id);
    if (cap?.type !== 'arc') continue;
    result.push({ id: `${slot.id}:cap:${id}:radius`, type: 'equal', param1: { o_id: id, prop: 'radius' }, param2: half });
    for (const [point, prop] of [
      [cap.startId, 'start_angle'],
      [cap.endId, 'end_angle'],
    ] as const)
      result.push({ id: `${slot.id}:cap:${id}:${prop}`, type: 'p2p_angle', p1_id: cap.centerId, p2_id: point, angle: { o_id: id, prop } });
  }
  return result;
}

/** A retained normal anchor on an adjacent support already fixes the shared endpoint's offset. */
function slotAnchoredEnds(slot: CadSlot, member: CadSlotMember, entities: ReadonlyMap<string, CadEntity>): ('start' | 'end')[] {
  const target = entities.get(member.targetId);
  if (member.kind === 'circle' || !target || (target.type !== 'line' && target.type !== 'arc')) return [];
  return (['start', 'end'] as const).filter(
    end =>
      !member.normalEnds.includes(end) &&
      slot.members.some(other => {
        const curve = entities.get(other.targetId);
        return (
          other !== member &&
          other.kind !== 'circle' &&
          (curve?.type === 'line' || curve?.type === 'arc') &&
          other.normalEnds.some(
            otherEnd => (otherEnd === 'start' ? curve.startId : curve.endId) === (end === 'start' ? target.startId : target.endId)
          )
        );
      })
  );
}
export function slotArcRuleOverrides(slots: readonly CadSlot[], entities: ReadonlyMap<string, CadEntity>): Set<string> {
  return new Set(
    slots.flatMap(slot =>
      slot.members.filter(member => member.kind === 'arc' && slotAnchoredEnds(slot, member, entities).length).map(member => member.targetId)
    )
  );
}
