type Vec3 = [number, number, number];

/** How far from the clicked plane a vertex may lie and still count as on it, in mm. */
const kOnPlane = 1e-3;

/**
 * Where a click on a flat face snaps to: the nearest of the face's corners and its middle, so parts placed against
 * each other line up exactly rather than wherever the pointer happened to be. Everything lying in the clicked plane
 * counts as the face.
 */
export function snapToFace(positions: ArrayLike<number>, point: Vec3, normal: Vec3): Vec3 {
  const plane = normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2];
  const corners: Vec3[] = [];
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const p: Vec3 = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
    if (Math.abs(normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2] - plane) > kOnPlane) continue;
    corners.push(p);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
  }
  if (!corners.length) return point;
  const middle = min.map((value, k) => (value + max[k]!) / 2) as Vec3;
  const distance = (p: Vec3) => Math.hypot(p[0] - point[0], p[1] - point[1], p[2] - point[2]);
  return [middle, ...corners].reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best));
}
