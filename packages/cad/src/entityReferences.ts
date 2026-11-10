import type { CadConstraint, CadEntity } from './types';

export function entityPointIds(entity: CadEntity): string[] {
  switch (entity.type) {
    case 'point':
      return [];
    case 'line':
      return [entity.startId, entity.endId];
    case 'ellipse':
      return [entity.centerId, entity.focusId, entity.majorStartId, entity.majorEndId, entity.minorStartId, entity.minorEndId];
    case 'circle':
      return [entity.centerId];
    case 'arc':
      return [entity.centerId, entity.startId, entity.endId];
    case 'conic':
      return [entity.startId, entity.controlId, entity.endId];
    case 'bezier':
      return [...entity.controlPointIds];
    case 'spline':
      return [...new Set([entity.startId, entity.endId, ...entity.controlPointIds, ...entity.fitPointIds])];
  }
}

export function constraintEntityIds(constraint: CadConstraint): string[] {
  if (constraint.type === 'slot')
    return Array.isArray(constraint.sourceIds) && Array.isArray(constraint.generatedIds)
      ? [...constraint.sourceIds, ...constraint.generatedIds, constraint.widthEntityId]
      : [];
  if (constraint.type === 'linearPattern' || constraint.type === 'circularPattern')
    return Array.isArray(constraint.instances)
      ? [
          ...new Set([
            ...(constraint.type === 'circularPattern' ? [constraint.centerId] : []),
            ...constraint.instances.flatMap(i => (i && Array.isArray(i.activeIds) ? i.activeIds : [])),
          ]),
        ]
      : [];
  if (constraint.type === 'offset')
    return Array.isArray(constraint.members)
      ? [...new Set(constraint.members.flatMap(member => (member ? [member.sourceId, member.targetId] : [])))]
      : [];
  if (constraint.type === 'symmetricCurves') return [constraint.entityAId, constraint.entityBId, constraint.lineId];
  if (constraint.type === 'regularPolygon') return [constraint.circleId, ...constraint.edgeIds];
  if (constraint.type === 'symmetricPoints') return [constraint.pointAId, constraint.pointBId, constraint.lineId];
  if ('sourceEntityId' in constraint && constraint.sourceEntityId !== undefined)
    return [constraint.pointAId, constraint.pointBId, constraint.sourceEntityId];
  if ('pointId' in constraint && 'entityId' in constraint) return [constraint.pointId, constraint.entityId];
  if ('entityId' in constraint) return [constraint.entityId];
  if ('entityAId' in constraint) return [constraint.entityAId, constraint.entityBId];
  if ('pointId' in constraint) return [constraint.pointId];
  return [constraint.pointAId, constraint.pointBId];
}
