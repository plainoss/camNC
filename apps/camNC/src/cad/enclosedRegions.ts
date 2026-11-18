import { CAD_CHORD_TOLERANCE, regionInteriorPoint, sketchRegions, type CadDocument, type CadPart, type CadPointEntity } from '@wbcnc/cad';

/** The regions of a part's sketch that other extrudes of the same sketch take. */
function usedRegions(document: CadDocument, part: CadPart): Set<string> {
  const owner = part.sketchOf ?? part.id;
  return new Set(
    document.parts
      .filter(other => other.id !== part.id && (other.id === owner || other.sketchOf === owner) && other.extrude !== false)
      .flatMap(other => other.regions ?? [])
  );
}

/**
 * The regions picked along with one, as the reference picks a sketch's face: a region inside a circle takes the rest of
 * that circle with it where an earlier extrude of the same sketch already used it, so one click on a circle's free part
 * extrudes the whole circle.
 */
export function enclosedUsedRegions(document: CadDocument, part: CadPart, regionId: string): string[] {
  const used = usedRegions(document, part);
  if (!used.size) return [];
  const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
  const inside = new Map(
    regions.flatMap(region => {
      const point = regionInteriorPoint(region.points);
      return point ? [[region.id, point] as const] : [];
    })
  );
  const picked = inside.get(regionId);
  if (!picked) return [];
  const points = new Map(part.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
  const circles = part.sketch.entities.flatMap(entity => {
    if (entity.type !== 'circle' || entity.construction) return [];
    const center = points.get(entity.centerId);
    return center ? [{ center, radius: entity.radius }] : [];
  });
  const within = (point: { x: number; y: number }, circle: (typeof circles)[number]) =>
    Math.hypot(point.x - circle.center.x, point.y - circle.center.y) < circle.radius;
  const around = circles.filter(circle => within(picked, circle));
  return regions
    .filter(region => region.id !== regionId && used.has(region.id))
    .filter(region => {
      const point = inside.get(region.id);
      return !!point && around.some(circle => within(point, circle));
    })
    .map(region => region.id);
}

/**
 * How many entries a selection of regions lists: each region picked is one, and the faces an earlier extrude of the
 * sketch used, taken along with a circle's free part, belong to that pick's entry.
 */
export function regionEntries(document: CadDocument, part: CadPart, regionIds: readonly string[]): number {
  return Math.max(1, regionEntrySizes(document, part, regionIds).length);
}

/** How many faces each entry of a selection of regions holds: one, or a circle's with the faces taken along. */
export function regionEntrySizes(document: CadDocument, part: CadPart, regionIds: readonly string[]): number[] {
  const used = usedRegions(document, part);
  const along = new Map(regionIds.filter(id => !used.has(id)).map(id => [id, enclosedUsedRegions(document, part, id)]));
  const takenAlong = new Set([...along.values()].flat());
  return regionIds.filter(id => !takenAlong.has(id)).map(id => 1 + (along.get(id)?.filter(other => regionIds.includes(other)).length ?? 0));
}
