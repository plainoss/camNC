import type { CadCutDepth, CadPart } from './types';

/** Position a face Remove without replacing the cut feature whose identity later pocket-floor sketches use. */
export function faceRemovalDepth(part: CadPart, thickness: number): { depth: CadCutDepth; derived: boolean } | { error: string } {
  const remove = part.remove!;
  const on = part.drawnOn?.on;
  if (remove.targets && (!on || !('partId' in on) || remove.targets.length !== 1 || remove.targets[0] !== on.partId))
    return { error: 'A face Remove cuts its support. Sketch on a plane to choose other parts.' };
  const derived = !part.hole && !!(part.upTo || part.symmetric || part.drawnOn?.offset || part.drawnOn?.inward !== undefined);
  if (!derived) return { depth: remove.depth, derived: false };
  const inward = part.drawnOn?.inward !== false;
  const depth = part.upTo ? part.thickness : remove.depth;
  const offset = part.drawnOn?.offset ?? 0;
  let from: number, to: number;
  if (depth === 'through') {
    from = part.symmetric || !inward ? -Infinity : -offset;
    to = part.symmetric || inward ? Infinity : -offset;
  } else if (part.symmetric) {
    from = -offset - depth / 2;
    to = -offset + depth / 2;
  } else {
    from = -offset - (inward ? 0 : depth);
    to = -offset + (inward ? depth : 0);
  }
  // Face pockets must open on their support face; an enclosed cavity cannot be machined from that face.
  if (from > 1e-6 || to <= 0) return { error: 'This extrusion does not reach the face it cuts. Change its direction, depth or offset.' };
  return { depth: to >= thickness - 1e-6 ? 'through' : to, derived: true };
}
