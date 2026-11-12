import type { OutlineNotches } from './toolpathTypes';

/** Words only, no geometry: the app describes these without loading the planner. */

const round1 = (v: number) => +v.toFixed(1);

/** What a path leaves uncut, in a sentence a user can act on (without the part's name). */
export function describeOutlineNotches(n: OutlineNotches): string {
  const one = n.count === 1;
  const left = `${round1(n.area)} mm² left`;
  if (!n.spans)
    return `Material is left in ${one ? 'a notch or sharp corner' : `${n.count} notches or sharp corners`} the ⌀${n.diameter} bit can’t reach (${left}). Choose a smaller bit, or round ${one ? 'it' : 'them'} to the bit.`;
  // The widest disk that fits is at most the bit: as wide as it, the bit can't get in either.
  const wide = n.width >= n.diameter - 0.05 ? 'no wider than' : 'narrower than';
  const path = n.inside ? 'the hole’s path' : 'the outline';
  return `${one ? 'A notch' : `${n.count} notches`} about ${round1(n.width)} mm wide, such as a finger joint’s fingers, ${one ? 'is' : 'are'} ${wide} the ⌀${n.diameter} bit and won’t be cut: ${path} runs straight across (${left}). Choose a smaller bit, or make the fingers wider.`;
}
