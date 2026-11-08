import { CAD_GEOMETRY_TOLERANCE, pointInPolygon, type CadPoint } from '@wbcnc/cad';

/** A through opening is a notch if any of its boundary touches or crosses the part's edge. */
export function isEdgeNotch(cut: { through: boolean; outline: CadPoint[] }, outline: CadPoint[]): boolean {
  if (!cut.through) return false;
  if (cut.outline.some(point => !pointInPolygon(point, outline))) return true;
  const cross = (a: CadPoint, b: CadPoint, c: CadPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return cut.outline.some((a, i) => {
    const b = cut.outline[(i + 1) % cut.outline.length]!;
    return outline.some((c, j) => {
      const d = outline[(j + 1) % outline.length]!;
      const eps = CAD_GEOMETRY_TOLERANCE;
      if (
        Math.max(a.x, b.x) + eps < Math.min(c.x, d.x) ||
        Math.max(c.x, d.x) + eps < Math.min(a.x, b.x) ||
        Math.max(a.y, b.y) + eps < Math.min(c.y, d.y) ||
        Math.max(c.y, d.y) + eps < Math.min(a.y, b.y)
      )
        return false;
      const e = eps * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(d.x - c.x, d.y - c.y));
      const o1 = cross(a, b, c),
        o2 = cross(a, b, d),
        o3 = cross(c, d, a),
        o4 = cross(c, d, b);
      return !((o1 > e && o2 > e) || (o1 < -e && o2 < -e) || (o3 > e && o4 > e) || (o3 < -e && o4 < -e));
    });
  });
}
