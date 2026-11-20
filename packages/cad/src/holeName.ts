import type { CadPart } from './types';

const mm = (value: number) => `${+value.toFixed(3)} mm`;

/** A Hole step's name, as the feature list and its dialog read it: ⌀ 6 mm THRU, or ⌀ 10 mm x 5 mm for a blind one. */
export function cadHoleName(part: Pick<CadPart, 'hole' | 'remove'>): string {
  const across = `⌀ ${mm(part.hole?.diameter ?? 0)}`;
  const depth = part.remove?.depth;
  return typeof depth === 'number' ? `${across} x ${mm(depth)}` : `${across} THRU`;
}
