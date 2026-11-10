import type { CadPart } from './types';

/** Solve supports before the parts drawn on them, preserving source order at equal depth. */
export function supportsFirst(parts: CadPart[]): CadPart[] {
  const byId = new Map(parts.map(part => [part.id, part]));
  const depth = new Map<string, number>();
  const depthOf = (part: CadPart, seen = new Set<string>()): number => {
    const known = depth.get(part.id);
    if (known !== undefined) return known;
    const on = part.drawnOn?.on;
    const support = on && 'partId' in on ? byId.get(on.partId) : undefined;
    seen.add(part.id);
    const value = support && !seen.has(support.id) ? depthOf(support, seen) + 1 : 0;
    depth.set(part.id, value);
    return value;
  };
  return parts
    .map((part, index) => ({ part, index, depth: depthOf(part) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map(({ part }) => part);
}
