import { areaD, type PathD, type PathsD } from 'clipper2-ts';
import { bounds2, difference, offset, polyArea } from './geom';
import { components } from './passPlanning';
import type { OutlineNotches } from './toolpathTypes';

/**
 * A rounded inside corner leaves at most a 0.17 r wide sliver beside the bit (r(√2−1)/(√2+1) for a square one); a
 * notch the bit can't enter leaves the whole notch. Spots with room for a disk of this share of r are notches.
 */
const kNotchFit = 0.25;
/**
 * However thin, a piece this big (× r²) is a notch too, such as a slit far narrower than the bit. A square inside
 * corner leaves about 0.215 r², a 74° one about 0.40 r²: they stay quiet.
 */
const kNotchArea = 0.5;
/** The notch's own extent: its region against a bit this many times as wide. */
const kMouthScale = 3;
/** A piece filling this share of that region bridges the notch's mouth: the path runs straight across it. */
const kSpans = 0.9;

/** How wide a notch is: the widest disk that fits in it, to 0.01 mm. It can't be wider than the bit. */
function notchWidth(notch: PathsD, r: number, tolerance: number): number {
  let [fits, wide] = [0, r];
  while (wide - fits > 0.005) {
    const mid = (fits + wide) / 2;
    if (offset(notch, -mid, tolerance).length) fits = mid;
    else wide = mid;
  }
  return 2 * fits;
}

/** The path's loop, as `profileOperation` keeps it: the largest. Anything it closes off is never cut. */
const largest = (paths: PathsD) => paths.sort((a, b) => Math.abs(areaD(b)) - Math.abs(areaD(a))).slice(0, 1);

/**
 * What the profile path with a bit of radius `r` leaves of the waste: outside an outline (`inside` false), or inside
 * a hole loop (CCW, as in the features). It runs one loop, so what that loop closes off counts as left too.
 */
function leftBy(loop: PathD, r: number, inside: boolean, tolerance: number): PathsD {
  if (inside) return difference([loop], offset(largest(offset([loop], -r, tolerance)), r, tolerance));
  return difference(offset(largest(offset([loop], r, tolerance)), -r, tolerance), [loop]);
}

/**
 * What a profile path along `loop` leaves in notches the bit can't enter, such as finger joint slots narrower than
 * the bit, or in sharp inside corners: one entry for the pieces that fill their notch to the mouth (`spans`), one for
 * the others, each with the narrowest piece's width. Ordinary rounded inside corners don't count.
 */
export function loopNotches(loop: PathD, index: number, diameter: number, tolerance: number, inside = false): OutlineNotches[] {
  const r = diameter / 2;
  const pieces = components(leftBy(loop, r, inside, tolerance)).filter(
    piece => Math.abs(polyArea(piece)) >= kNotchArea * r * r || offset(piece, -kNotchFit * r, tolerance).length > 0
  );
  if (!pieces.length) return [];
  const regions = components(leftBy(loop, kMouthScale * r, inside, tolerance)).map(region => ({
    region,
    box: bounds2(region),
    area: Math.abs(polyArea(region)),
  }));
  const measured = pieces.map(piece => {
    const area = Math.abs(polyArea(piece));
    const box = bounds2(piece);
    // The notch's own region: the bigger bit leaves all that the smaller one does, so one of its pieces holds this one.
    const own = regions.find(
      ({ region, box: b }) =>
        b.minX <= box.maxX &&
        box.minX <= b.maxX &&
        b.minY <= box.maxY &&
        box.minY <= b.maxY &&
        Math.abs(polyArea(difference(piece, region))) < 0.5 * area
    );
    return {
      area,
      width: notchWidth(piece, r, tolerance),
      spans: area >= kSpans * Math.max(area, own?.area ?? area),
      at: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    };
  });
  return [true, false].flatMap(spans => {
    const group = measured.filter(m => m.spans === spans);
    if (!group.length) return [];
    return [
      {
        outline: index,
        ...(inside && { inside: true as const }),
        count: group.length,
        width: Math.min(...group.map(m => m.width)),
        diameter,
        spans,
        area: group.reduce((sum, m) => sum + m.area, 0),
        at: group.map(m => m.at),
      },
    ];
  });
}
