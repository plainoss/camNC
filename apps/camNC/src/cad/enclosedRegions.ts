import { CAD_CHORD_TOLERANCE, regionInteriorPoint, sketchRegions, type CadDocument, type CadPart, type CadPointEntity } from '@wbcnc/cad';

/**
 * The regions picked along with one, as the reference picks a sketch's face: a region inside a circle takes the rest of
 * that circle with it where an earlier extrude of the same sketch already used it, so one click on a circle's free part
 * extrudes the whole circle.
 */
export function enclosedUsedRegions(document: CadDocument, part: CadPart, regionId: string): string[] {
  const owner = part.sketchOf ?? part.id;
  const used = new Set(
    document.parts
      .filter(other => other.id !== part.id && (other.id === owner || other.sketchOf === owner) && other.extrude !== false)
      .flatMap(other => other.regions ?? [])
  );
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
