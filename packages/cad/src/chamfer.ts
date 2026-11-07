import { newCadId, constraintEntityIds } from './document';
import { lineCorner, resolveFilletCorners } from './fillet';
import { CAD_GEOMETRY_TOLERANCE, evaluateCadPart } from './geometry';
import { pointEquivalence } from './pointEquivalence';
import type { CadLineEntity, CadPointEntity, CadSketch } from './types';

export const resolveChamferCorners = (sketch: CadSketch, selectedIds: readonly string[]) => {
  const result = resolveFilletCorners(sketch, selectedIds, true);
  return result.ok ? result : { ...result, message: result.message.replace(/fillet/gi, 'chamfer').replace('profile ', '') };
};
export interface CadChamferOptions {
  cornerPointIds: readonly string[];
  distanceA: number;
  distanceB: number;
  /** Selected line order determines the first setback when two edges are selected. */
  selectedLineIds?: readonly string[];
}
export type CadChamferResult =
  | { ok: true; sketch: CadSketch; cornerPointIds: string[]; lineIds: string[]; dimensionIds: [string, string] }
  | { ok: false; message: string; cornerPointIds: string[] };

/** Retain virtual sharp references and drive the two setbacks independently across every selected corner. */
export function chamferLineCorners(sketch: CadSketch, options: CadChamferOptions): CadChamferResult {
  const equivalent = pointEquivalence(sketch.constraints);
  const cornerPointIds = [...new Set(options.cornerPointIds.map(equivalent.canonical))];
  const fail = (message: string): CadChamferResult => ({ ok: false, message, cornerPointIds });
  const sizes = [options.distanceA, options.distanceB] as const;
  if (!cornerPointIds.length) return fail('Select a shared corner or two adjacent straight lines.');
  if (sizes.some(value => !Number.isFinite(value) || value <= CAD_GEOMETRY_TOLERANCE))
    return fail('Enter two finite chamfer distances greater than zero.');
  const corners = [];
  const consumption = new Map<string, { total: number; length: number }>();
  for (const id of cornerPointIds) {
    const corner = lineCorner(sketch, id, equivalent, true);
    if (typeof corner === 'string') return fail(corner.replace(/fillet/gi, 'chamfer').replace('profile ', ''));
    const order = options.selectedLineIds ?? [];
    const selectedFirst = order.find(lineId => corner.lines.some(line => line.id === lineId));
    const indices = selectedFirst === corner.lines[1].id ? ([1, 0] as const) : ([0, 1] as const);
    corners.push({ corner, indices });
    indices.forEach((index, side) => {
      const line = corner.lines[index];
      const before = consumption.get(line.id);
      consumption.set(line.id, { total: (before?.total ?? 0) + sizes[side]!, length: corner.lengths[index] });
    });
  }
  if ([...consumption.values()].some(edge => edge.total >= edge.length - CAD_GEOMETRY_TOLERANCE))
    return fail('These distances would consume an entire adjacent line. Choose smaller distances.');
  const next = structuredClone(sketch);
  const changed = new Set(corners.flatMap(({ corner }) => corner.lines.map(line => line.id)));
  // Finite ownership no longer describes the shortened boundary. Keep unrelated dimensions and support relations.
  next.constraints = next.constraints.filter(
    c => !((c.type === 'offset' || c.type === 'regularPolygon') && constraintEntityIds(c).some(id => changed.has(id)))
  );
  const dimensionIds: [string, string] = [newCadId(), newCadId()];
  const firstSetbacks: string[] = [];
  const lineIds: string[] = [];
  for (const { corner, indices } of corners) {
    for (const id of corner.aliases) {
      const point = next.entities.find(entity => entity.id === id);
      if (point) point.construction = true;
    }
    const endpoints: CadPointEntity[] = [];
    indices.forEach((index, side) => {
      const direction = corner.directions[index];
      const source = corner.lines[index];
      const endpoint: CadPointEntity = {
        id: newCadId(),
        type: 'point',
        x: corner.point.x + direction.x * sizes[side]!,
        y: corner.point.y + direction.y * sizes[side]!,
        construction: source.construction,
      };
      endpoints.push(endpoint);
      const line = next.entities.find((entity): entity is CadLineEntity => entity.id === source.id && entity.type === 'line')!;
      const oldEndpointId = corner.endpointIds[index];
      if (line.startId === oldEndpointId) line.startId = endpoint.id;
      else line.endId = endpoint.id;
      if (!next.constraints.some(c => c.type === 'pointOnLine' && c.pointId === oldEndpointId && c.entityId === line.id))
        next.constraints.push({ id: newCadId(), type: 'pointOnLine', pointId: oldEndpointId, entityId: line.id });
      const setback: CadLineEntity = { id: newCadId(), type: 'line', startId: oldEndpointId, endId: endpoint.id, construction: true };
      next.entities.push(endpoint, setback);
      if (firstSetbacks[side])
        next.constraints.push({ id: newCadId(), type: 'equal', entityAId: firstSetbacks[side]!, entityBId: setback.id });
      else {
        firstSetbacks[side] = setback.id;
        next.constraints.push({
          id: dimensionIds[side]!,
          type: 'distance',
          pointAId: oldEndpointId,
          pointBId: endpoint.id,
          sourceEntityId: setback.id,
          value: sizes[side]!,
          label: `Chamfer distance ${side + 1}`,
        });
      }
    });
    const line: CadLineEntity = {
      id: newCadId(),
      type: 'line',
      startId: endpoints[0]!.id,
      endId: endpoints[1]!.id,
      construction: corner.lines.every(edge => edge.construction) || undefined,
    };
    next.entities.push(line);
    lineIds.push(line.id);
  }
  const profile = (value: CadSketch) =>
    evaluateCadPart({ id: 'chamfer-validation', name: 'Chamfer validation', thickness: 1, sketch: value });
  if (profile(sketch).part && !profile(next).part)
    return fail('These distances would make the chamfer cross, touch, or disconnect other profile geometry.');
  return { ok: true, sketch: next, cornerPointIds, lineIds, dimensionIds };
}
