import { distPointSeg, type Vec3 } from '../src/geom';

type Primitive = { from: Vec3; to: Vec3; center?: [number, number]; clockwise?: boolean };
const turn = (angle: number) => ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** Independent ideal G1/G2/G3 floor oracle: arcs stay analytic rather than becoming visualization chords. */
export function postedFloorDistance(program: string, floor: number): (x: number, y: number) => number {
  let position: Vec3 = [0, 0, 0],
    motion = 0,
    plane = 17;
  const primitives: Primitive[] = [];
  for (const raw of program.split('\n')) {
    const line = raw.replace(/\([^)]*\)/g, '').trim();
    if (!line || /G53\b/.test(line)) continue;
    const words: Record<string, number> = {};
    for (const [, key, value] of line.matchAll(/([A-Z])\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/g)) {
      const number = Number(value);
      if (key === 'G') {
        if (number <= 3) motion = number;
        else if ([17, 18, 19].includes(number)) plane = number;
      } else words[key] = number;
    }
    if (!['X', 'Y', 'Z'].some(axis => axis in words)) continue;
    const to: Vec3 = [words.X ?? position[0], words.Y ?? position[1], words.Z ?? position[2]];
    if (motion !== 0 && to[2] === floor) {
      if (position[2] !== floor) primitives.push({ from: to, to });
      else if (motion === 1) primitives.push({ from: position, to });
      else {
        if (plane !== 17) throw new Error('Floor oracle requires XY arcs');
        primitives.push({
          from: position,
          to,
          center: [position[0] + (words.I ?? 0), position[1] + (words.J ?? 0)],
          clockwise: motion === 2,
        });
      }
    }
    position = to;
  }
  return (x, y) =>
    Math.min(
      ...primitives.map(primitive => {
        const { from, to, center, clockwise } = primitive;
        if (!center) return distPointSeg(x, y, from[0], from[1], to[0], to[1]);
        const start = Math.atan2(from[1] - center[1], from[0] - center[0]);
        const end = Math.atan2(to[1] - center[1], to[0] - center[0]);
        const angle = Math.atan2(y - center[1], x - center[0]);
        const sweep = turn(clockwise ? start - end : end - start);
        const part = turn(clockwise ? start - angle : angle - start);
        const ends = Math.min(Math.hypot(x - from[0], y - from[1]), Math.hypot(x - to[0], y - to[1]));
        return part <= sweep + 1e-12
          ? Math.min(ends, Math.abs(Math.hypot(x - center[0], y - center[1]) - Math.hypot(from[0] - center[0], from[1] - center[1])))
          : ends;
      })
    );
}
