import { addLine, createCadPart } from './document';
import type { CadPart, CadPoint, CadPointEntity, CadSketch } from './types';

/**
 * The strips a thin extrude makes of a sketch's picked open lines, as closed outlines in the sketch's own coordinates:
 * each line widened by Thickness 1 to its right, walking it from its start, and Thickness 2 to its left, or by half
 * of Thickness 1 either side with Mid plane. A Remove cuts them as slots.
 */
export function thinSlotSketch(part: CadPart): { sketch: CadSketch; strips: CadPoint[][] } | null {
  const wall = part.thinWall;
  if (!wall || !part.thinEdges?.length) return null;
  const right = wall.midPlane ? wall.thickness1 / 2 : wall.thickness1,
    left = wall.midPlane ? wall.thickness1 / 2 : wall.thickness2;
  const points = new Map(
    part.sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  let sketch = createCadPart('Slots').sketch;
  const strips: CadPoint[][] = [];
  for (const id of part.thinEdges) {
    const line = part.sketch.entities.find(entity => entity.id === id);
    if (!line || line.type !== 'line') continue;
    const a = points.get(line.startId),
      b = points.get(line.endId);
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length <= 0) continue;
    // To the right of the walk from start to end.
    const n = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
    const at = (p: { x: number; y: number }, by: number) => ({ x: p.x + n.x * by, y: p.y + n.y * by });
    const corners = [at(a, right), at(b, right), at(b, -left), at(a, -left)];
    strips.push(corners);
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % corners.length]!;
      sketch = addLine(sketch, { x1: p.x, y1: p.y, x2: q.x, y2: q.y });
    });
  }
  return strips.length ? { sketch, strips } : null;
}
