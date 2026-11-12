type Loop = { x: number; y: number }[];

/** Douglas-Peucker on a closed loop: every dropped point stays within `tol` of the segment that replaces it. */
export function simplifyLoop(loop: Loop, tol: number): Loop {
  if (loop.length < 4) return loop;
  const keep = new Uint8Array(loop.length);
  const stack: [number, number][] = [];
  // Split the loop at its first point and the point farthest from it.
  let far = 0,
    farD = -1;
  loop.forEach((p, i) => {
    const d = (p.x - loop[0].x) ** 2 + (p.y - loop[0].y) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  keep[0] = keep[far] = 1;
  const closed = [...loop, loop[0]];
  stack.push([0, far], [far, loop.length]);
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = closed[a],
      B = closed[b];
    const dx = B.x - A.x,
      dy = B.y - A.y,
      lengthSquared = dx * dx + dy * dy;
    let best = -1,
      bestD = tol;
    for (let i = a + 1; i < b; i++) {
      // Distance to the segment, not its infinite supporting line: returning branches must not disappear for free.
      const t = lengthSquared ? Math.max(0, Math.min(1, ((closed[i].x - A.x) * dx + (closed[i].y - A.y) * dy) / lengthSquared)) : 0;
      const d = Math.hypot(closed[i].x - A.x - t * dx, closed[i].y - A.y - t * dy);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return loop.filter((_, i) => keep[i]);
}
