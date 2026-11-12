import type { PathD, PathsD } from 'clipper2-ts';
import { difference, offset } from './geom';
import { components } from './passPlanning';
import { outlineNotchNote } from './outlineNotchNote';

/**
 * A rounded inside corner leaves at most a 0.17 r wide sliver beside the bit (r(√2−1)/(√2+1) for a square one); a
 * notch the bit can't enter leaves the whole notch. Spots with room for a disk of this share of r are notches.
 */
const kNotchFit = 0.25;

/** How wide a notch is: the widest disk that fits in it, to 0.01 mm. It can't be wider than the bit. */
function notchWidth(notch: PathsD, r: number, tolerance: number): number {
  let [fits, wide] = [kNotchFit * r, r];
  while (wide - fits > 0.005) {
    const mid = (fits + wide) / 2;
    if (offset(notch, -mid, tolerance).length) fits = mid;
    else wide = mid;
  }
  return 2 * fits;
}

/**
 * The notches in an outline that a bit of `diameter` can't enter, such as finger joint slots narrower than the bit:
 * the outline's path runs straight across them, so they stay full of material. Their widths, narrowest first.
 */
export function outlineNotchesTooNarrow(outline: PathD, diameter: number, tolerance: number): number[] {
  const r = diameter / 2;
  // Where the bit runs outside the outline sweeps the outline's closing: what that adds is left uncut.
  const swept = offset(offset([outline], r, tolerance), -r, tolerance);
  const left = difference(swept, [outline]);
  return components(left)
    .filter(spot => offset(spot, -kNotchFit * r, tolerance).length > 0)
    .map(spot => notchWidth(spot, r, tolerance))
    .sort((a, b) => a - b);
}

/** The plan's note for an outline whose notches the bit can't enter, or undefined when it reaches all of them. */
export function outlineNotchWarning(index: number, outline: PathD, diameter: number, tolerance: number): string | undefined {
  const widths = outlineNotchesTooNarrow(outline, diameter, tolerance);
  return widths.length ? outlineNotchNote(index, widths.length, widths[0]!, diameter) : undefined;
}
